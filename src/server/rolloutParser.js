import fs from "node:fs";
import { cleanChatText, stringifyVisibleValue } from "./chatText.js";

const MAX_OUTPUT_PREVIEW = 6000;

function textFromContent(content) {
  if (content && typeof content === "object" && !Array.isArray(content)) {
    return stringifyVisibleValue(content);
  }
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (part?.text) return stringifyVisibleValue(part.text);
      if (part?.type === "input_text" || part?.type === "output_text") return stringifyVisibleValue(part.text);
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function isVisibleChatText(text) {
  const trimmed = text.trim();
  return !(
    trimmed.startsWith("<environment_context>") ||
    trimmed.startsWith("<subagent_notification>") ||
    trimmed.startsWith("<model_switch>") ||
    trimmed.startsWith("Warning: The maximum number of unified exec processes you can keep open")
  );
}

function stableId(threadId, lineNumber, suffix = "event") {
  return `${threadId}:${lineNumber}:${suffix}`;
}

function parseJsonObject(value) {
  if (!value || typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function basename(value = "") {
  return String(value).split("/").filter(Boolean).pop() || String(value);
}

function commandText(command) {
  if (Array.isArray(command)) {
    if (command.length >= 3 && command[1] === "-lc") return command[2];
    return command.join(" ");
  }
  return stringifyVisibleValue(command);
}

function parsedCommandActivity(parsedCommands, fallbackCommand) {
  const commands = Array.isArray(parsedCommands) ? parsedCommands : [];
  const readCommands = commands.filter((command) => command?.type === "read");
  if (readCommands.length === 1) {
    return { activityType: "read", activityLabel: `已浏览 ${basename(readCommands[0].name || readCommands[0].path || readCommands[0].cmd)}` };
  }
  if (readCommands.length > 1) {
    return { activityType: "read", activityLabel: `已浏览 ${readCommands.length} 个文件` };
  }
  const text = commandText(fallbackCommand);
  return text ? { activityType: "run", activityLabel: `已运行 ${text}` } : null;
}

function applyPatchActivity(input) {
  const text = stringifyVisibleValue(input);
  if (!text.trim()) return null;
  const files = [];
  let current = null;
  for (const line of text.split("\n")) {
    const fileMatch = line.match(/^\*\*\* (?:Update|Add|Delete) File: (.+)$/);
    if (fileMatch) {
      current = { file: fileMatch[1], added: 0, removed: 0 };
      files.push(current);
      continue;
    }
    if (!current) continue;
    if (line.startsWith("+") && !line.startsWith("+++")) current.added += 1;
    if (line.startsWith("-") && !line.startsWith("---")) current.removed += 1;
  }
  if (!files.length) return null;
  const totals = files.reduce((acc, file) => ({ added: acc.added + file.added, removed: acc.removed + file.removed }), { added: 0, removed: 0 });
  const fileLabel = files.length === 1 ? basename(files[0].file) : `${files.length} 个文件`;
  return {
    activityType: "edit",
    activityLabel: `已编辑 ${fileLabel} +${totals.added} -${totals.removed}`
  };
}

export function normalizeRolloutEvent(entry, lineNumber, fallbackThreadId) {
  const threadId = entry.payload?.thread_id || fallbackThreadId;
  const createdAt = entry.timestamp || new Date(0).toISOString();
  const payload = entry.payload || {};

  if (entry.type === "response_item" && payload.type === "message") {
    if (!["user", "assistant"].includes(payload.role)) return null;
    const text = cleanChatText(textFromContent(payload.content));
    if (!text) return null;
    if (!isVisibleChatText(text)) return null;
    return {
      id: stableId(threadId, lineNumber, payload.role || "message"),
      threadId,
      role: payload.role || "assistant",
      kind: "message",
      text,
      createdAt
    };
  }

  if (entry.type === "event_msg" && payload.type === "user_message") {
    const text = cleanChatText(payload.message || "");
    if (!text) return null;
    if (!isVisibleChatText(text)) return null;
    return {
      id: stableId(threadId, lineNumber, "user"),
      threadId,
      role: "user",
      kind: "message",
      text,
      createdAt
    };
  }

  if (entry.type === "event_msg" && payload.type === "agent_message") {
    const text = cleanChatText(payload.message || "");
    if (!text) return null;
    if (!isVisibleChatText(text)) return null;
    return {
      id: stableId(threadId, lineNumber, "assistant"),
      threadId,
      role: "assistant",
      kind: "message",
      text,
      createdAt
    };
  }

  if (entry.type === "response_item" && payload.type === "function_call") {
    const args = parseJsonObject(payload.arguments);
    const activity =
      payload.name === "exec_command" && args?.cmd ? { activityType: "run", activityLabel: `已运行 ${args.cmd}` } : null;
    return {
      id: stableId(threadId, lineNumber, payload.call_id || "tool-call"),
      threadId,
      role: "tool",
      kind: "tool_call",
      toolName: payload.name || "tool",
      toolStatus: "started",
      text: payload.arguments || "",
      ...activity,
      createdAt
    };
  }

  if (entry.type === "response_item" && payload.type === "custom_tool_call") {
    const activity = payload.name === "apply_patch" ? applyPatchActivity(payload.input || payload.arguments || "") : null;
    return {
      id: stableId(threadId, lineNumber, payload.call_id || "tool-call"),
      threadId,
      role: "tool",
      kind: "tool_call",
      toolName: payload.name || "tool",
      toolStatus: payload.status || "started",
      text: stringifyVisibleValue(payload.input || payload.arguments || ""),
      ...activity,
      createdAt
    };
  }

  if (entry.type === "response_item" && (payload.type === "function_call_output" || payload.type === "custom_tool_call_output")) {
    const output = stringifyVisibleValue(payload.output);
    return {
      id: stableId(threadId, lineNumber, payload.call_id || "tool-output"),
      threadId,
      role: "tool",
      kind: "tool_output",
      toolStatus: "finished",
      outputPreview: output.length > MAX_OUTPUT_PREVIEW ? `${output.slice(0, MAX_OUTPUT_PREVIEW)}\n...` : output,
      createdAt
    };
  }

  if (entry.type === "event_msg" && payload.type === "task_started") {
    return {
      id: stableId(threadId, lineNumber, "task_started"),
      threadId,
      role: "system",
      kind: "run_state",
      toolName: "task_started",
      toolStatus: "started",
      outputPreview: "Task started",
      createdAt
    };
  }

  if (entry.type === "event_msg" && payload.type === "task_complete") {
    const seconds = Number(payload.duration_ms) / 1000;
    const duration = Number.isFinite(seconds) ? ` in ${seconds.toFixed(1)}s` : "";
    const lastMessage = stringifyVisibleValue(payload.last_agent_message || "");
    return {
      id: stableId(threadId, lineNumber, "task_complete"),
      threadId,
      role: "system",
      kind: "run_state",
      toolName: "task_complete",
      toolStatus: "finished",
      outputPreview: [`Task complete${duration}`, lastMessage].filter(Boolean).join("\n"),
      createdAt
    };
  }

  if (entry.type === "event_msg" && typeof payload.type === "string" && payload.type.endsWith("_end")) {
    const activity = parsedCommandActivity(payload.parsed_cmd, payload.command);
    return {
      id: stableId(threadId, lineNumber, payload.call_id || payload.type),
      threadId,
      role: "tool",
      kind: "tool_output",
      toolName: payload.type,
      toolStatus: stringifyVisibleValue(payload.status || "finished"),
      outputPreview: stringifyVisibleValue(payload.aggregated_output || payload.stderr || payload.stdout || ""),
      ...activity,
      createdAt
    };
  }

  return null;
}

function appendNormalizedRolloutEvent(state, normalized) {
  if (!normalized) return;
  if (normalized.kind === "message") {
    const key = `${normalized.role}:${normalized.text}`;
    const createdAtMs = new Date(normalized.createdAt).getTime();
    const lastSeenAtMs = state.lastMessageByText.get(key);
    if (Number.isFinite(createdAtMs) && Number.isFinite(lastSeenAtMs) && createdAtMs - lastSeenAtMs <= 1000) {
      return;
    }
    state.lastMessageByText.set(key, createdAtMs);
  }
  state.events.push(normalized);
}

function appendRolloutParseError(state, line) {
  state.events.push({
    id: stableId(state.threadId, state.lineNumber, "parse-error"),
    threadId: state.threadId,
    role: "system",
    kind: "tool_output",
    toolStatus: "failed",
    outputPreview: line.slice(0, MAX_OUTPUT_PREVIEW),
    createdAt: new Date(0).toISOString()
  });
}

function processRolloutLine(state, line) {
  state.lineNumber += 1;
  if (!line.trim()) return;
  try {
    const entry = JSON.parse(line);
    appendNormalizedRolloutEvent(state, normalizeRolloutEvent(entry, state.lineNumber, state.threadId));
  } catch {
    appendRolloutParseError(state, line);
  }
}

export function createRolloutParseState(threadId, seed = {}) {
  const seededEvents = Array.isArray(seed.events)
    ? seed.events
    : Array.isArray(seed.messages)
      ? seed.messages
      : [];
  return {
    threadId,
    events: [...seededEvents],
    lastMessageByText:
      seed.lastMessageByText instanceof Map ? new Map(seed.lastMessageByText) : new Map(Array.isArray(seed.lastMessageByText) ? seed.lastMessageByText : []),
    lineNumber: Number(seed.lineNumber) || 0,
    remainder: typeof seed.remainder === "string" ? seed.remainder : ""
  };
}

export function appendRolloutText(state, text) {
  if (!text) return state;
  const combined = `${state.remainder}${text}`;
  const lines = combined.split(/\r?\n/);
  state.remainder = /\r?\n$/.test(combined) ? "" : lines.pop() || "";
  for (const line of lines) {
    processRolloutLine(state, line);
  }
  return state;
}

export function finalizeRolloutParseState(state) {
  if (state.remainder) {
    const trailingLine = state.remainder;
    state.remainder = "";
    processRolloutLine(state, trailingLine);
  }
  return state;
}

export async function parseRolloutFileState(rolloutPath, threadId) {
  const state = createRolloutParseState(threadId);
  if (!rolloutPath || !fs.existsSync(rolloutPath)) return state;
  const stream = fs.createReadStream(rolloutPath, { encoding: "utf8" });
  for await (const chunk of stream) {
    appendRolloutText(state, chunk);
  }
  return finalizeRolloutParseState(state);
}

export async function parseRolloutFile(rolloutPath, threadId) {
  const state = await parseRolloutFileState(rolloutPath, threadId);
  return state.events;
}
