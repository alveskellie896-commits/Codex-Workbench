import fs from "node:fs/promises";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { CODEX_REMOTE_MODEL, CODEX_SEND_MODE, codexProcessEnv, resolveCodexCliCommand } from "./config.js";
import {
  openCodexThreadInDesktop,
  reloadCodexDesktopWindow,
  restartCodexDesktopAndOpenThread,
  sendToCodexDesktop,
  stopCodexDesktopResponse
} from "./desktopDriver.js";
import {
  DEFAULT_RUNTIME_CONTROLS,
  buildCodexExecResumeArgs,
  normalizeRuntimeControls,
  prefixPromptForPlanMode,
  runtimeCapabilities
} from "./runtimeControls.js";

class RunManagerError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const DESKTOP_SYNC_DEBOUNCE_MS = 2500;
const DESKTOP_SEND_CONFIRM_TIMEOUT_MS = 30000;
const DESKTOP_SEND_CONFIRM_POLL_MS = 500;

function desktopSyncEnabled() {
  return process.env.CODEX_DESKTOP_SYNC !== "off";
}

function desktopForceReloadEnabled() {
  return process.env.CODEX_DESKTOP_FORCE_RELOAD !== "off";
}

function desktopSyncStrategy() {
  return (process.env.CODEX_DESKTOP_SYNC_STRATEGY || "restart").trim().toLowerCase();
}

async function fileMtimeMs(filePath) {
  if (!filePath) return 0;
  try {
    return (await fs.stat(filePath)).mtimeMs;
  } catch {
    return 0;
  }
}

function normalizeMessageText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function messageMatchesPrompt(message, prompt) {
  if (message?.role !== "user" || message?.kind !== "message") return false;
  const left = normalizeMessageText(message.text);
  const right = normalizeMessageText(prompt);
  if (!left || !right) return false;
  return left === right || left.includes(right) || right.includes(left);
}

function makeFollowUp(threadId, prompt, controls = {}) {
  return {
    id: `follow:${threadId}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
    threadId,
    prompt: String(prompt || ""),
    controls: normalizeRuntimeControls(controls),
    status: "queued",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    error: ""
  };
}

export class RunManager extends EventEmitter {
  constructor({ getThread, getMessages = null, appServerClient = null }) {
    super();
    this.getThread = getThread;
    this.getMessages = getMessages;
    this.appServerClient = appServerClient;
    this.states = new Map();
    this.lastInputs = new Map();
    this.model = CODEX_REMOTE_MODEL;
    this.threadModels = new Map();
    this.lastDesktopSyncAt = new Map();
    this.runtimeDefaults = normalizeRuntimeControls({ model: CODEX_REMOTE_MODEL });
    this.threadRuntime = new Map();
    this.followUps = new Map();
  }

  getModel(threadId = null, fallbackModel = "") {
    return (threadId && this.threadModels.get(threadId)) || fallbackModel || this.model;
  }

  setModel(model, threadId = null) {
    const nextModel = String(model || "").trim();
    if (!nextModel) throw new RunManagerError(400, "Model is required");
    if (threadId) {
      this.threadModels.set(threadId, nextModel);
      const runtime = this.getRuntime(threadId);
      this.setRuntime({ ...runtime, model: nextModel }, threadId);
      this.emit("model.changed", { threadId, model: nextModel });
      return { threadId, model: nextModel };
    }
    this.model = nextModel;
    this.setRuntime({ ...this.runtimeDefaults, model: nextModel });
    this.emit("model.changed", { model: this.model });
    return { model: this.model };
  }

  getRuntime(threadId = null) {
    const fallback = normalizeRuntimeControls({ ...this.runtimeDefaults, model: this.getModel(threadId) || this.model });
    if (!threadId) return fallback;
    return normalizeRuntimeControls(this.threadRuntime.get(threadId) || {}, fallback);
  }

  setRuntime(controls = {}, threadId = null) {
    if (threadId) {
      const next = normalizeRuntimeControls(controls, this.getRuntime(threadId));
      this.threadRuntime.set(threadId, next);
      if (next.model) this.threadModels.set(threadId, next.model);
      this.emit("runtime.changed", { threadId, controls: next });
      return next;
    }
    this.runtimeDefaults = normalizeRuntimeControls(controls, this.runtimeDefaults);
    if (this.runtimeDefaults.model) this.model = this.runtimeDefaults.model;
    this.emit("runtime.changed", { controls: this.runtimeDefaults });
    return this.runtimeDefaults;
  }

  runtimeCapabilities() {
    return runtimeCapabilities(CODEX_SEND_MODE);
  }

  getState(threadId) {
    const state =
      this.states.get(threadId) || {
        threadId,
        activeRunId: null,
        phase: "idle",
        canCancel: false,
        canRetry: this.lastInputs.has(threadId)
      };
    const { process, ...publicState } = state;
    return {
      ...publicState,
      queuedFollowUps: this.listFollowUps(threadId).filter((item) => item.status === "queued").length
    };
  }

  getActiveStates() {
    return Array.from(this.states.values()).filter((state) => state.activeRunId);
  }

  listFollowUps(threadId) {
    return [...(this.followUps.get(threadId) || [])];
  }

  enqueueFollowUp(threadId, prompt, controls = {}) {
    if (!prompt?.trim()) throw new RunManagerError(400, "Follow-up message is required");
    const item = makeFollowUp(threadId, prompt, controls);
    const queue = this.listFollowUps(threadId);
    this.followUps.set(threadId, [...queue, item]);
    this.emit("followup.queued", { threadId, item });
    this.#drainFollowUpsSoon(threadId, 50);
    return item;
  }

  updateFollowUp(threadId, followUpId, patch = {}) {
    const queue = this.listFollowUps(threadId);
    const index = queue.findIndex((item) => item.id === followUpId);
    if (index < 0) throw new RunManagerError(404, "Queued follow-up not found");
    if (queue[index].status !== "queued") throw new RunManagerError(409, "Only queued follow-ups can be edited");
    queue[index] = {
      ...queue[index],
      prompt: patch.prompt === undefined ? queue[index].prompt : String(patch.prompt || ""),
      controls: patch.controls ? normalizeRuntimeControls(patch.controls, queue[index].controls) : queue[index].controls,
      updatedAt: new Date().toISOString()
    };
    this.followUps.set(threadId, queue);
    this.emit("followup.updated", { threadId, item: queue[index] });
    return queue[index];
  }

  cancelFollowUp(threadId, followUpId) {
    const queue = this.listFollowUps(threadId);
    const index = queue.findIndex((item) => item.id === followUpId);
    if (index < 0) throw new RunManagerError(404, "Queued follow-up not found");
    queue[index] = { ...queue[index], status: "cancelled", updatedAt: new Date().toISOString() };
    this.followUps.set(threadId, queue);
    this.emit("followup.cancelled", { threadId, item: queue[index] });
    return queue[index];
  }

  reorderFollowUp(threadId, followUpId, direction = "up") {
    const queue = this.listFollowUps(threadId);
    const index = queue.findIndex((item) => item.id === followUpId);
    if (index < 0) throw new RunManagerError(404, "Queued follow-up not found");
    const target = direction === "down" ? index + 1 : index - 1;
    if (target < 0 || target >= queue.length) return queue[index];
    const copy = [...queue];
    [copy[index], copy[target]] = [copy[target], copy[index]];
    this.followUps.set(threadId, copy);
    this.emit("followup.reordered", { threadId, items: copy });
    return copy[target];
  }

  async send(threadId, prompt, options = {}) {
    if (!prompt?.trim()) throw new RunManagerError(400, "Message is required");
    const current = this.getState(threadId);
    const controls = normalizeRuntimeControls(options.runtime || {}, this.getRuntime(threadId));
    if (current.activeRunId) {
      if (options.queueIfRunning) {
        const item = this.enqueueFollowUp(threadId, prompt, controls);
        return { ...this.getState(threadId), queued: true, followUp: item, steerActiveRun: false };
      }
      throw new RunManagerError(409, "Thread already has an active run");
    }
    const runId = `${threadId}:${Date.now()}`;
    this.#setState(threadId, {
      threadId,
      activeRunId: runId,
      phase: "starting",
      canCancel: false,
      canRetry: false,
      runtime: controls
    });
    const thread = await this.getThread(threadId);
    if (!thread) {
      this.#clearRun(threadId);
      throw new RunManagerError(404, "Thread not found");
    }
    this.lastInputs.set(threadId, prompt);
    return this.#start(thread, prompt, runId, controls);
  }

  async retry(threadId) {
    const prompt = this.lastInputs.get(threadId);
    if (!prompt) throw new RunManagerError(400, "No previous input to retry");
    return this.send(threadId, prompt, { runtime: this.getRuntime(threadId) });
  }

  async cancel(threadId) {
    const state = this.states.get(threadId);
    if (state?.transport === "app-server" && state.turnId && this.appServerClient) {
      this.appServerClient.interrupt(threadId, state.turnId).catch((error) => {
        this.emit("run.failed", { threadId, runId: state.activeRunId, error: error.message });
      });
      this.#setState(threadId, { ...state, phase: "cancelling", canCancel: false });
      return { cancelled: true, state: this.getState(threadId) };
    }
    if (CODEX_SEND_MODE === "desktop") {
      const thread = await this.getThread(threadId);
      if (!thread) throw new RunManagerError(404, "Thread not found");
      const runId = state?.activeRunId || null;
      this.#setState(threadId, {
        threadId,
        activeRunId: null,
        phase: "cancelling",
        canCancel: false,
        canRetry: this.lastInputs.has(threadId),
        transport: "desktop"
      });
      await openCodexThreadInDesktop(threadId);
      await delay(250);
      await stopCodexDesktopResponse();
      this.#setState(threadId, {
        threadId,
        activeRunId: null,
        phase: "cancelled",
        canCancel: false,
        canRetry: this.lastInputs.has(threadId),
        transport: "desktop"
      });
      this.emit("run.failed", { threadId, runId, signal: "desktop-interrupt", transport: "desktop" });
      return { cancelled: true, state: this.getState(threadId) };
    }
    if (!state?.process) return { cancelled: false, state: this.getState(threadId) };
    state.process.kill("SIGTERM");
    this.#setState(threadId, { ...state, phase: "cancelling", canCancel: false });
    return { cancelled: true, state: this.getState(threadId) };
  }

  #setState(threadId, state) {
    this.states.set(threadId, { ...state, updatedAt: new Date().toISOString() });
    this.emit("status", this.getState(threadId));
  }

  #isRunCurrent(threadId, runId) {
    return this.states.get(threadId)?.activeRunId === runId;
  }

  completeAppServerTurn(threadId, turn, failed = false) {
    const state = this.states.get(threadId);
    if (!state?.activeRunId || state.transport !== "app-server") return;
    if (state.turnId && turn?.id && state.turnId !== turn.id) return;
    const phase = failed || turn?.status === "failed" ? "failed" : turn?.status === "interrupted" ? "cancelled" : "idle";
    const runId = state.activeRunId;
    this.#setState(threadId, {
      threadId,
      activeRunId: null,
      turnId: null,
      phase,
      canCancel: false,
      canRetry: this.lastInputs.has(threadId),
      transport: "app-server"
    });
    this.emit(phase === "idle" ? "run.finished" : "run.failed", {
      threadId,
      runId,
      turnId: turn?.id || state.turnId || null,
      transport: "app-server"
    });
    this.#syncDesktopThread(threadId, runId, "turn-completed");
    this.#drainFollowUpsSoon(threadId, 300);
  }

  #start(thread, prompt, runId, controls) {
    if (CODEX_SEND_MODE === "desktop") return this.#startViaDesktop(thread, prompt, runId, controls);
    if (this.appServerClient) return this.#startViaAppServer(thread, prompt, runId, controls);
    return this.#startViaCli(thread, prompt, runId, controls);
  }

  #startViaDesktop(thread, prompt, runId, controls) {
    this.#setState(thread.id, {
      threadId: thread.id,
      activeRunId: runId,
      phase: "sending-to-desktop",
      canCancel: true,
      canRetry: false,
      transport: "desktop",
      runtime: { ...controls, unsupportedControls: ["reasoningEffort", "accessMode", "planMode"] }
    });

    openCodexThreadInDesktop(thread.id)
      .then(() => delay(process.platform === "win32" ? 2600 : 900))
      .then(async () => {
        if (!this.#isRunCurrent(thread.id, runId)) return false;
        const baseline = await this.#desktopSubmissionBaseline(thread);
        await sendToCodexDesktop(prefixPromptForPlanMode(prompt, controls));
        const confirmed = await this.#waitForDesktopSubmission(thread, prompt, baseline);
        if (!confirmed) {
          throw new Error("Did not detect Codex Desktop receiving the message. Keep Codex open and retry.");
        }
        return true;
      })
      .then((delivered) => {
        if (!delivered) return;
        this.emit("run.event", { threadId: thread.id, runId, event: { type: "desktop.delivered" }, transport: "desktop" });
        this.#setState(thread.id, {
          threadId: thread.id,
          activeRunId: null,
          phase: "idle",
          canCancel: false,
          canRetry: this.lastInputs.has(thread.id),
          transport: "desktop"
        });
        this.emit("run.finished", { threadId: thread.id, runId, transport: "desktop" });
        this.#drainFollowUpsSoon(thread.id, 800);
      })
      .catch((error) => {
        this.#setState(thread.id, {
          threadId: thread.id,
          activeRunId: null,
          phase: "failed",
          canCancel: false,
          canRetry: this.lastInputs.has(thread.id),
          lastError: error.stderr || error.message,
          transport: "desktop"
        });
        this.emit("run.failed", { threadId: thread.id, runId, error: error.message, transport: "desktop" });
      });

    this.emit("run.started", { threadId: thread.id, runId, transport: "desktop" });
    return this.getState(thread.id);
  }

  async #desktopSubmissionBaseline(thread) {
    const messages = await this.#readMessages(thread.id);
    return {
      rolloutMtimeMs: await fileMtimeMs(thread.rolloutPath),
      messageIds: new Set(messages.map((message) => message.id).filter(Boolean))
    };
  }

  async #readMessages(threadId) {
    if (!this.getMessages) return [];
    try {
      return (await this.getMessages(threadId)) || [];
    } catch {
      return [];
    }
  }

  async #waitForDesktopSubmission(thread, prompt, baseline) {
    const deadline = Date.now() + DESKTOP_SEND_CONFIRM_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await delay(DESKTOP_SEND_CONFIRM_POLL_MS);
      if ((await fileMtimeMs(thread.rolloutPath)) > baseline.rolloutMtimeMs) return true;
      const messages = await this.#readMessages(thread.id);
      if (messages.some((message) => !baseline.messageIds.has(message.id) && messageMatchesPrompt(message, prompt))) {
        return true;
      }
    }
    return false;
  }

  #startViaAppServer(thread, prompt, runId, controls) {
    this.#setState(thread.id, {
      threadId: thread.id,
      activeRunId: runId,
      phase: "resuming",
      canCancel: false,
      canRetry: false,
      transport: "app-server",
      runtime: controls
    });

    this.appServerClient
      .resumeThread(thread)
      .then((resume) =>
        this.appServerClient.startTurn(
          { ...thread, cwd: resume?.cwd || resume?.thread?.cwd || thread.cwd },
          prompt,
          { ...controls, model: controls.model || this.getModel(thread.id, thread.model) }
        )
      )
      .then((result) => {
        this.#setState(thread.id, {
          threadId: thread.id,
          activeRunId: runId,
          turnId: result?.turn?.id || null,
          phase: "running",
          canCancel: Boolean(result?.turn?.id),
          canRetry: false,
          transport: "app-server",
          runtime: controls
        });
        this.emit("run.started", { threadId: thread.id, runId, turnId: result?.turn?.id || null, transport: "app-server" });
        this.#syncDesktopThread(thread.id, runId, "turn-started");
      })
      .catch((error) => {
        this.emit("run.output", { threadId: thread.id, runId, stream: "app-server", text: `App server failed, falling back to CLI: ${error.message}` });
        this.#startViaCli(thread, prompt, runId, controls);
      });

    return this.getState(thread.id);
  }

  #startViaCli(thread, prompt, runId, controls) {
    const args = buildCodexExecResumeArgs({
      threadId: thread.id,
      prompt,
      model: this.getModel(thread.id, thread.model),
      controls
    });
    const child = spawn(resolveCodexCliCommand(), args, {
      cwd: thread.cwd,
      env: codexProcessEnv(),
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdoutBuffer = "";
    let stderrBuffer = "";
    this.#setState(thread.id, {
      threadId: thread.id,
      activeRunId: runId,
      phase: "running",
      canCancel: true,
      canRetry: false,
      process: child,
      transport: "cli",
      runtime: controls
    });
    this.emit("run.started", { threadId: thread.id, runId, transport: "cli" });

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdoutBuffer = this.#handleOutput(thread.id, runId, `${stdoutBuffer}${chunk}`);
    });
    child.stderr.on("data", (chunk) => {
      stderrBuffer += chunk;
      this.emit("run.output", { threadId: thread.id, runId, stream: "stderr", text: chunk });
    });

    child.on("error", (error) => {
      this.#setState(thread.id, {
        threadId: thread.id,
        activeRunId: null,
        phase: "failed",
        canCancel: false,
        canRetry: this.lastInputs.has(thread.id),
        transport: "cli"
      });
      this.emit("run.failed", { threadId: thread.id, runId, error: error.message });
    });

    child.on("exit", (code, signal) => {
      if (stdoutBuffer.trim()) this.#parseOutputLine(thread.id, runId, stdoutBuffer.trim());
      const phase = code === 0 ? "idle" : signal ? "cancelled" : "failed";
      this.#setState(thread.id, {
        threadId: thread.id,
        activeRunId: null,
        phase,
        canCancel: false,
        canRetry: this.lastInputs.has(thread.id),
        lastError: phase === "failed" ? stderrBuffer.trim() || `Codex CLI exited with code ${code}` : null,
        transport: "cli"
      });
      this.emit(code === 0 ? "run.finished" : "run.failed", { threadId: thread.id, runId, code, signal });
      this.#drainFollowUpsSoon(thread.id, 500);
    });

    return this.getState(thread.id);
  }

  #clearRun(threadId) {
    this.#setState(threadId, {
      threadId,
      activeRunId: null,
      phase: "idle",
      canCancel: false,
      canRetry: this.lastInputs.has(threadId)
    });
  }

  #drainFollowUpsSoon(threadId, waitMs) {
    setTimeout(() => this.#drainFollowUps(threadId).catch((error) => {
      this.emit("run.failed", { threadId, error: error.message, transport: "follow-up-queue" });
    }), waitMs).unref?.();
  }

  async #drainFollowUps(threadId) {
    if (this.getState(threadId).activeRunId) return;
    const queue = this.listFollowUps(threadId);
    const next = queue.find((item) => item.status === "queued");
    if (!next) return;
    this.followUps.set(threadId, queue.map((item) => item.id === next.id ? { ...item, status: "sending", updatedAt: new Date().toISOString() } : item));
    try {
      await this.send(threadId, next.prompt, { runtime: next.controls });
      this.followUps.set(threadId, this.listFollowUps(threadId).map((item) => item.id === next.id ? { ...item, status: "submitted", updatedAt: new Date().toISOString() } : item));
    } catch (error) {
      this.followUps.set(threadId, this.listFollowUps(threadId).map((item) => item.id === next.id ? { ...item, status: "failed", error: error.message, updatedAt: new Date().toISOString() } : item));
      throw error;
    }
  }

  #syncDesktopThread(threadId, runId, reason) {
    if (!desktopSyncEnabled()) return;
    const key = `${threadId}:${reason}`;
    const now = Date.now();
    const last = this.lastDesktopSyncAt.get(key) || 0;
    if (now - last < DESKTOP_SYNC_DEBOUNCE_MS) return;
    this.lastDesktopSyncAt.set(key, now);

    this.#syncDesktopThreadNow(threadId, runId, reason)
      .catch((error) => {
        this.emit("run.output", {
          threadId,
          runId,
          stream: "desktop-sync",
          text: `Could not refresh Codex Desktop: ${error.message}`
        });
      });
  }

  async #syncDesktopThreadNow(threadId, runId, reason) {
    const strategy = desktopSyncStrategy();
    if (reason === "turn-completed" && strategy === "restart") {
      await delay(1200);
      const result = await restartCodexDesktopAndOpenThread(threadId);
      this.emit("run.event", {
        threadId,
        runId,
        event: { type: "desktop.restarted", reason, strategy: result.strategy },
        transport: "app-server"
      });
      return;
    }

    await openCodexThreadInDesktop(threadId);
    this.emit("run.event", {
      threadId,
      runId,
      event: { type: "desktop.thread-opened", reason },
      transport: "app-server"
    });

    if (reason !== "turn-completed" || !desktopForceReloadEnabled() || strategy === "open-only") return;
    const result = await delay(800).then(() => reloadCodexDesktopWindow());
    this.emit("run.event", {
      threadId,
      runId,
      event: { type: "desktop.reloaded", reason, strategy: result.strategy },
      transport: "app-server"
    });
  }

  #handleOutput(threadId, runId, chunk) {
    const lines = chunk.split("\n");
    const remainder = lines.pop() || "";
    for (const line of lines) {
      this.#parseOutputLine(threadId, runId, line);
    }
    return remainder;
  }

  #parseOutputLine(threadId, runId, line) {
    if (!line.trim()) return;
    try {
      this.emit("run.event", { threadId, event: JSON.parse(line) });
    } catch {
      this.emit("run.output", { threadId, runId, stream: "stdout", text: line });
    }
  }
}
