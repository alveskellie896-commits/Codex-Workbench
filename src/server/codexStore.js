import fs from "node:fs/promises";
import path from "node:path";
import { codexPath } from "./config.js";
import { appendRolloutText, createRolloutParseState, finalizeRolloutParseState, parseRolloutFileState } from "./rolloutParser.js";
import { sqliteJson } from "./sqlite.js";
import { makeDiagnosticCheck } from "./systemDiagnostics.js";

const stateDb = codexPath("state_5.sqlite");
const sessionIndexPath = codexPath("session_index.jsonl");
const stateWal = `${stateDb}-wal`;
const stateShm = `${stateDb}-shm`;
const MAX_SESSION_META_BYTES = 256 * 1024;
const ROLLOUT_STATUS_CHUNK_BYTES = 256 * 1024;
const THREAD_ROW_SQL = `
  select
    id,
    title,
    cwd,
    updated_at_ms,
    updated_at,
    rollout_path,
    archived,
    git_branch,
    model,
    agent_nickname,
    agent_role
  from threads
  where archived = 0
`;
const sessionIndexCache = {
  mtimeMs: -1,
  names: new Map()
};
const rolloutMessagesCache = new Map();
const rolloutStatusCache = new Map();
const subagentMetaCache = new Map();

function basenameLabel(cwd) {
  const base = path.basename(cwd || "");
  return base || cwd || "Unknown Project";
}

async function readSessionIndex() {
  try {
    const stat = await fs.stat(sessionIndexPath);
    if (sessionIndexCache.mtimeMs === stat.mtimeMs) return sessionIndexCache.names;
    const raw = await fs.readFile(sessionIndexPath, "utf8");
    const names = new Map();
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        const item = JSON.parse(line);
        if (item.id && item.thread_name) names.set(item.id, item.thread_name);
      } catch {
        // Ignore malformed index lines; SQLite remains the source of truth.
      }
    }
    sessionIndexCache.mtimeMs = stat.mtimeMs;
    sessionIndexCache.names = names;
    return names;
  } catch {
    sessionIndexCache.mtimeMs = -1;
    sessionIndexCache.names = new Map();
    return new Map();
  }
}

function toIso(value) {
  const number = Number(value || 0);
  if (!number) return new Date(0).toISOString();
  return new Date(number > 9999999999 ? number : number * 1000).toISOString();
}

function maybeToIso(value) {
  const number = Number(value || 0);
  return number ? toIso(number) : "";
}

function formatBytes(bytes = 0) {
  if (!Number.isFinite(Number(bytes))) return "0 B";
  const value = Number(bytes);
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 102.4) / 10} KB`;
  if (value < 1024 * 1024 * 1024) return `${Math.round(value / 1024 / 102.4) / 10} MB`;
  return `${Math.round(value / 1024 / 1024 / 102.4) / 10} GB`;
}

async function fileSnapshot(filePath) {
  try {
    const stat = await fs.stat(filePath);
    await fs.access(filePath);
    return {
      path: filePath,
      exists: true,
      readable: true,
      size: stat.size,
      sizeLabel: formatBytes(stat.size),
      mtime: new Date(stat.mtimeMs).toISOString()
    };
  } catch (error) {
    return {
      path: filePath,
      exists: false,
      readable: false,
      size: 0,
      sizeLabel: "0 B",
      mtime: "",
      error: error?.message || "File is not readable"
    };
  }
}

async function stateDatabaseSummary() {
  try {
    const [row] = await sqliteJson(
      stateDb,
      `
        select
          count(*) as threadCount,
          count(distinct cwd) as projectCount,
          max(coalesce(updated_at_ms, updated_at * 1000, 0)) as latestUpdatedAt
        from threads
        where archived = 0
      `
    );
    return {
      ok: true,
      threadCount: Number(row?.threadCount || 0),
      projectCount: Number(row?.projectCount || 0),
      latestThreadUpdatedAt: maybeToIso(row?.latestUpdatedAt)
    };
  } catch (error) {
    return {
      ok: false,
      threadCount: 0,
      projectCount: 0,
      latestThreadUpdatedAt: "",
      error: error?.message || "Unable to query Codex state database"
    };
  }
}

async function readFirstJsonLine(filePath) {
  if (!filePath) return null;
  let handle;
  try {
    handle = await fs.open(filePath, "r");
    const chunks = [];
    let total = 0;
    while (total < MAX_SESSION_META_BYTES) {
      const buffer = Buffer.alloc(8192);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, total);
      if (!bytesRead) break;
      const chunk = buffer.subarray(0, bytesRead);
      const newlineAt = chunk.indexOf(10);
      if (newlineAt >= 0) {
        chunks.push(chunk.subarray(0, newlineAt));
        break;
      }
      chunks.push(chunk);
      total += bytesRead;
    }
    const line = Buffer.concat(chunks).toString("utf8").trim();
    return line ? JSON.parse(line) : null;
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function readSubagentMeta(row) {
  const fallback = {
    parentThreadId: null,
    subagentDepth: null,
    agentNickname: row.agent_nickname || "",
    agentRole: row.agent_role || ""
  };
  if (!row.agent_nickname && !row.agent_role) return fallback;
  if (!row.rollout_path) return fallback;
  try {
    const stat = await fs.stat(row.rollout_path);
    const cached = subagentMetaCache.get(row.rollout_path);
    if (cached && cached.mtimeMs === stat.mtimeMs) return cached.meta;
    const firstLine = await readFirstJsonLine(row.rollout_path);
    const spawn = firstLine?.payload?.source?.subagent?.thread_spawn;
    const meta = {
      parentThreadId: spawn?.parent_thread_id || null,
      subagentDepth: Number.isFinite(Number(spawn?.depth)) ? Number(spawn.depth) : null,
      agentNickname: row.agent_nickname || firstLine?.payload?.agent_nickname || spawn?.agent_nickname || "",
      agentRole: row.agent_role || firstLine?.payload?.agent_role || spawn?.agent_role || ""
    };
    subagentMetaCache.set(row.rollout_path, { mtimeMs: stat.mtimeMs, meta });
    return meta;
  } catch {
    subagentMetaCache.delete(row.rollout_path);
    return fallback;
  }
}

function rolloutEventTime(entry) {
  const time = new Date(entry?.timestamp || 0).getTime();
  return Number.isFinite(time) && time > 0 ? new Date(time).toISOString() : "";
}

async function readRolloutStatus(row) {
  if (!row?.rollout_path) return { status: "idle", latestRunStateAt: "" };
  try {
    const stat = await fs.stat(row.rollout_path);
    const cached = rolloutStatusCache.get(row.rollout_path);
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached.status;

    const handle = await fs.open(row.rollout_path, "r");
    try {
      let position = stat.size;
      let carry = "";
      while (position > 0) {
        const length = Math.min(position, ROLLOUT_STATUS_CHUNK_BYTES);
        position -= length;
        const buffer = Buffer.alloc(length);
        const { bytesRead } = await handle.read(buffer, 0, length, position);
        const text = buffer.subarray(0, bytesRead).toString("utf8") + carry;
        const lines = text.split("\n");
        carry = position > 0 ? lines.shift() || "" : "";
        for (let index = lines.length - 1; index >= 0; index -= 1) {
          const line = lines[index]?.trim();
          if (!line) continue;
          try {
            const entry = JSON.parse(line);
            const payload = entry?.payload || {};
            if (entry?.type !== "event_msg") continue;
            if (payload.type === "task_complete") {
              const status = { status: "complete", latestRunStateAt: rolloutEventTime(entry) };
              rolloutStatusCache.set(row.rollout_path, { mtimeMs: stat.mtimeMs, size: stat.size, status });
              return status;
            }
            if (payload.type === "task_started") {
              const status = { status: "incomplete", latestRunStateAt: rolloutEventTime(entry) };
              rolloutStatusCache.set(row.rollout_path, { mtimeMs: stat.mtimeMs, size: stat.size, status });
              return status;
            }
          } catch {
            // Chunk boundaries can produce partial lines; keep scanning older complete lines.
          }
        }
      }
    } finally {
      await handle.close().catch(() => {});
    }
  } catch {
    rolloutStatusCache.delete(row?.rollout_path);
  }
  const status = { status: "incomplete", latestRunStateAt: "" };
  if (row?.rollout_path) rolloutStatusCache.set(row.rollout_path, { mtimeMs: -1, size: -1, status });
  return status;
}

async function rowToThread(row, names) {
  const subagent = await readSubagentMeta(row);
  const rolloutStatus = await readRolloutStatus(row);
  const isSubagent = Boolean(subagent.parentThreadId || subagent.agentNickname || subagent.agentRole);
  return {
    id: row.id,
    title: names.get(row.id) || row.title || "Untitled Thread",
    cwd: row.cwd,
    updatedAt: toIso(row.updated_at_ms || row.updated_at),
    status: rolloutStatus.status,
    latestRunStateAt: rolloutStatus.latestRunStateAt,
    rolloutPath: row.rollout_path,
    gitBranch: row.git_branch || "",
    model: row.model || "",
    parentThreadId: subagent.parentThreadId,
    isSubagent,
    agentNickname: subagent.agentNickname || "",
    agentRole: subagent.agentRole || "",
    subagentDepth: subagent.subagentDepth,
    subagents: []
  };
}

async function selectThreadRows({ projectCwd = "", threadId = "" } = {}) {
  let sql = THREAD_ROW_SQL;
  const params = [];
  if (threadId) {
    sql += " and id = ?";
    params.push(threadId);
  } else if (projectCwd) {
    sql += " and cwd = ?";
    params.push(projectCwd);
  }
  sql += " order by coalesce(updated_at_ms, updated_at * 1000) desc, id desc";
  return sqliteJson(stateDb, sql, params);
}

function attachSubagents(threads, { includeSubagents = false } = {}) {
  const byId = new Map(threads.map((thread) => [thread.id, { ...thread, subagents: [] }]));
  const roots = [];

  for (const thread of byId.values()) {
    if (thread.parentThreadId && byId.has(thread.parentThreadId)) {
      byId.get(thread.parentThreadId).subagents.push(thread);
    } else if (!thread.isSubagent || includeSubagents) {
      roots.push(thread);
    }
  }

  for (const thread of byId.values()) {
    thread.subagents.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  }

  return roots.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

function flattenThreads(threads) {
  const flattened = [];
  for (const thread of threads) {
    flattened.push(thread);
    flattened.push(...flattenThreads(thread.subagents || []));
  }
  return flattened;
}

export async function listThreads(projectCwd, options = {}) {
  const names = await readSessionIndex();
  try {
    await fs.access(stateDb);
  } catch {
    return [];
  }
  const rows = await selectThreadRows({ projectCwd });
  const threads = await Promise.all(rows.map((row) => rowToThread(row, names)));
  return attachSubagents(threads, options);
}

export async function getThread(threadId) {
  if (!threadId) return null;
  try {
    await fs.access(stateDb);
  } catch {
    return null;
  }
  const [row] = await selectThreadRows({ threadId });
  if (!row) return null;
  const names = await readSessionIndex();
  return rowToThread(row, names);
}

export async function listProjects() {
  const threads = await listThreads();
  const byCwd = new Map();

  for (const thread of threads) {
    if (!byCwd.has(thread.cwd)) {
      byCwd.set(thread.cwd, {
        cwd: thread.cwd,
        label: basenameLabel(thread.cwd),
        lastUpdatedAt: thread.updatedAt,
        threadCount: 0,
        recentThreads: []
      });
    }
    const project = byCwd.get(thread.cwd);
    project.threadCount += 1;
    project.recentThreads.push(thread);
    if (new Date(thread.updatedAt) > new Date(project.lastUpdatedAt)) {
      project.lastUpdatedAt = thread.updatedAt;
    }
  }

  return Array.from(byCwd.values()).sort((a, b) => new Date(b.lastUpdatedAt) - new Date(a.lastUpdatedAt));
}

export async function getMessages(threadId) {
  const thread = await getThread(threadId);
  if (!thread) return null;
  return getMessagesForThread(thread);
}

async function readCachedRolloutMessages(thread) {
  if (!thread?.rolloutPath) return [];
  try {
    const stat = await fs.stat(thread.rolloutPath);
    const cached = rolloutMessagesCache.get(thread.rolloutPath);
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached.messages;

    if (cached && stat.size >= cached.size) {
      const handle = await fs.open(thread.rolloutPath, "r");
      try {
        const deltaSize = stat.size - cached.size;
        const state = createRolloutParseState(thread.id, cached);
        if (deltaSize > 0) {
          const buffer = Buffer.alloc(deltaSize);
          const { bytesRead } = await handle.read(buffer, 0, buffer.length, cached.size);
          appendRolloutText(state, buffer.subarray(0, bytesRead).toString("utf8"));
        }
        finalizeRolloutParseState(state);
        rolloutMessagesCache.set(thread.rolloutPath, {
          mtimeMs: stat.mtimeMs,
          size: stat.size,
          messages: state.events,
          lineNumber: state.lineNumber,
          lastMessageByText: Array.from(state.lastMessageByText.entries()),
          remainder: state.remainder
        });
        return state.events;
      } finally {
        await handle.close().catch(() => {});
      }
    }

    const state = await parseRolloutFileState(thread.rolloutPath, thread.id);
    rolloutMessagesCache.set(thread.rolloutPath, {
      mtimeMs: stat.mtimeMs,
      size: stat.size,
      messages: state.events,
      lineNumber: state.lineNumber,
      lastMessageByText: Array.from(state.lastMessageByText.entries()),
      remainder: state.remainder
    });
    return state.events;
  } catch {
    rolloutMessagesCache.delete(thread?.rolloutPath);
    return [];
  }
}

export async function getMessagesForThread(thread) {
  if (!thread) return null;
  return readCachedRolloutMessages(thread);
}

export async function getSystemStatus(runStates = []) {
  const [dbFile, walFile, shmFile, indexFile, dbSummary] = await Promise.all([
    fileSnapshot(stateDb),
    fileSnapshot(stateWal),
    fileSnapshot(stateShm),
    fileSnapshot(sessionIndexPath),
    stateDatabaseSummary()
  ]);

  const checks = [
    makeDiagnosticCheck({
      id: "codex-home",
      label: "Codex 数据目录",
      status: dbFile.exists || indexFile.exists ? "ok" : "warning",
      detail: codexPath(),
      action: dbFile.exists || indexFile.exists ? "" : "先在电脑端打开一次 Codex"
    }),
    makeDiagnosticCheck({
      id: "state-db-file",
      label: "聊天数据库文件",
      status: dbFile.readable ? "ok" : "error",
      detail: dbFile.readable ? `${dbFile.sizeLabel}，更新于 ${dbFile.mtime}` : dbFile.error,
      action: dbFile.readable ? "" : "确认电脑端 Codex 能正常打开历史聊天"
    }),
    makeDiagnosticCheck({
      id: "state-db-query",
      label: "聊天数据库读取",
      status: dbSummary.ok ? "ok" : "error",
      detail: dbSummary.ok ? `${dbSummary.threadCount} 条会话，${dbSummary.projectCount} 个项目` : dbSummary.error,
      action: dbSummary.ok ? "" : "如果这里反复失败，重启 Codex 桌面端后再试"
    }),
    makeDiagnosticCheck({
      id: "session-index",
      label: "会话索引文件",
      status: indexFile.readable ? "ok" : "warning",
      detail: indexFile.readable ? `${indexFile.sizeLabel}，更新于 ${indexFile.mtime}` : "索引文件缺失时会退回数据库标题",
      action: indexFile.readable ? "" : "通常不影响发送，只会影响部分标题显示"
    }),
    makeDiagnosticCheck({
      id: "sqlite-wal",
      label: "数据库实时日志",
      status: "ok",
      detail:
        walFile.readable || shmFile.readable
          ? `WAL ${walFile.readable ? walFile.sizeLabel : "无"}，SHM ${shmFile.readable ? shmFile.sizeLabel : "无"}`
          : "当前没有 WAL/SHM 文件；这不一定是异常",
      action: ""
    })
  ];

  return {
    hostOnline: true,
    codexHome: codexPath(),
    stateDbReadable: dbFile.readable && dbSummary.ok,
    sessionIndexReadable: indexFile.readable,
    activeRuns: runStates.length,
    checkedAt: new Date().toISOString(),
    store: {
      stateDb: dbFile,
      stateWal: walFile,
      stateShm: shmFile,
      sessionIndex: indexFile,
      summary: dbSummary
    },
    checks
  };
}
