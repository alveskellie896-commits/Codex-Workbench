import fs from "node:fs";
import fsp from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { CodexAppServerClient } from "./appServerClient.js";
import { CODEX_HOME, CODEX_SEND_MODE, HOST, PORT, codexPath, codexProcessEnv, isLoopbackHost, resolveCodexCliCommand } from "./config.js";
import { getMessages, getMessagesForThread, getSystemStatus, getThread, listProjects, listThreads } from "./codexStore.js";
import { openCodexNewThreadInDesktop, openCodexThreadInDesktop } from "./desktopDriver.js";
import { passwordStatus, setPassword, verifyPassword } from "./passwordStore.js";
import { pairingStore } from "./pairingStore.js";
import { gitActionHelp, gitBranches, gitStatus, runGitAction } from "./gitService.js";
import { buildSubagentCommand, createSubagentRecord, listSubagentsForThread } from "./subagentStore.js";
import { RunManager } from "./runManager.js";
import { detectRolloutChanges } from "./rolloutChangeDetector.js";
import { makeDiagnosticCheck, readCurrentPhoneLink, summarizeDiagnosticChecks } from "./systemDiagnostics.js";
import { DEFAULT_THREAD_DETAIL_LIMIT, normalizeThreadDetailLimit, selectThreadConversationWindow, selectVisibleConversationMessages } from "./threadDetailWindow.js";
import { inferDesktopState } from "./threadState.js";
import {
  getAccessSession,
  issueTokenPair,
  refreshAccessToken,
  revokeAllTokens,
  revokeTokensForDevice,
  tokenDiagnostics,
  validateAccessToken
} from "./tokens.js";
import { formatPromptWithAttachments, saveBase64Upload } from "./uploads.js";
import { runtimePublicPayload } from "./runtimeControls.js";

const AVAILABLE_MODELS = [
  "gpt-5.5",
  "gpt-5.4",
  "gpt-5.4-mini",
  "gpt-5.3-codex",
  "gpt-5.3-codex-spark",
  "gpt-5.2"
];
const DEFAULT_JSON_BODY_LIMIT = 1024 * 1024;
const UPLOAD_JSON_BODY_LIMIT = 40 * 1024 * 1024;
const APP_SERVER_MESSAGE_TIMEOUT_MS = 1200;
const THREAD_START_INDEX_TIMEOUT_MS = 2200;
const THREAD_START_INDEX_POLL_MS = 180;
const HOT_THREAD_TTL_MS = 1000 * 60 * 5;
const HOT_THREAD_POLL_MS = 350;
const FULL_ROLLOUT_SCAN_MS = 3000;
const PWA_VERSION = "remodex-mobile-2026-05-04";
const MOBILE_API_VERSION = 1;
const MOBILE_UPLOAD_LIMITS = {
  maxFileBytes: 25 * 1024 * 1024,
  maxBatchBytes: 30 * 1024 * 1024,
  maxJsonBodyBytes: UPLOAD_JSON_BODY_LIMIT
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(__dirname, "../../dist");
const BUILD_ID = readBuildId(distDir);
const appServerClient = new CodexAppServerClient();
const runManager = new RunManager({ getThread, getMessages, appServerClient });
const clients = new Map();
const appServerMessagesCache = new Map();
const hotThreads = new Map();

function sendJson(res, statusCode, body) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(body));
}

function readBuildId(targetDistDir) {
  try {
    const indexHtml = fs.readFileSync(path.join(targetDistDir, "index.html"), "utf8");
    const scriptMatch = indexHtml.match(/src="([^"]*\/assets\/index-[^"]+\.js)"/i);
    if (scriptMatch?.[1]) return scriptMatch[1];
  } catch {}
  return `server:${Date.now()}`;
}

function requestWebSocketUrl(req) {
  const host = req.headers.host || `${HOST}:${PORT}`;
  const forwardedProto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  const isHttps = forwardedProto === "https" || req.socket?.encrypted;
  return `${isHttps ? "wss" : "ws"}://${host}/ws?token={accessToken}`;
}

async function mobileBootstrapPayload(req, manager) {
  const auth = await passwordStatus();
  const publicLink = await readCurrentPhoneLink().catch(() => null);
  const session = req.authSession || null;
  return {
    apiVersion: MOBILE_API_VERSION,
    platformTarget: "ios-native-and-web",
    service: {
      name: "Codex Workbench",
      pwaVersion: PWA_VERSION,
      buildId: BUILD_ID,
      serverTime: new Date().toISOString(),
      host: HOST,
      port: PORT,
      sendMode: CODEX_SEND_MODE
    },
    auth: {
      setupRequired: Boolean(auth.setupRequired),
      authenticated: Boolean(session),
      authMethod: session?.authMethod || "",
      trustLevel: session?.trustLevel || "",
      deviceId: session?.deviceId || "",
      accessTokenTtlSeconds: 30 * 60,
      refreshTokenTtlSeconds: 30 * 24 * 60 * 60,
      supported: ["password", "refresh-token", "trusted-device", "pairing-code"]
    },
    endpoints: {
      basePath: "/api",
      bootstrap: "/api/mobile/v1/bootstrap",
      webSocket: requestWebSocketUrl(req),
      authStatus: "/api/auth/status",
      login: "/api/auth/login",
      refresh: "/api/auth/refresh",
      deviceLogin: "/api/auth/device-login",
      pairingSession: "/api/pairing/session",
      pairingComplete: "/api/pairing/complete",
      projects: "/api/projects",
      threads: "/api/threads?project={projectCwd}",
      thread: "/api/threads/{threadId}",
      threadDetail: "/api/threads/{threadId}/detail?after={messageId}&before={messageId}&limit={limit}",
      send: "/api/threads/{threadId}/send",
      uploads: "/api/uploads",
      followUps: "/api/threads/{threadId}/followups",
      systemStatus: "/api/system/status",
      diagnostics: "/api/system/diagnostics",
      runtimeDefaults: "/api/runtime/defaults",
      model: "/api/system/model"
    },
    capabilities: {
      projects: true,
      threadList: true,
      threadDetailPaging: true,
      sendMessage: true,
      localSendQueueRecommended: true,
      followUps: true,
      fileUploads: true,
      trustedPairing: true,
      deviceRevocation: true,
      webSocketEvents: true,
      diagnostics: true,
      runtimeControls: true,
      modelSelection: true,
      git: true,
      subagents: true,
      browserFallbackSupported: true,
      nativePush: false
    },
    limits: {
      threadDetailDefaultLimit: DEFAULT_THREAD_DETAIL_LIMIT,
      upload: MOBILE_UPLOAD_LIMITS
    },
    runtime: runtimePublicPayload({ defaults: manager.getRuntime(), sendMode: CODEX_SEND_MODE }),
    model: modelPayload(manager),
    publicLink: publicLink
      ? {
          phoneUrl: publicLink.phoneUrl || "",
          computerUrl: publicLink.localUrl || "",
          tunnelType: publicLink.tunnelType || "",
          stable: Boolean(publicLink.stable),
          failureReason: publicLink.failureReason || ""
        }
      : null,
    notes: [
      "The iOS native app should treat this endpoint as the first boot contract.",
      "Codex still runs on the Windows computer; mobile clients display, upload, queue, and send through this service.",
      "When the computer is offline, the native app may keep local drafts but cannot receive Codex replies until this service returns."
    ]
  };
}

function readBody(req, { maxBytes = DEFAULT_JSON_BODY_LIMIT } = {}) {
  return new Promise((resolve, reject) => {
    let raw = "";
    let tooLarge = false;
    req.on("data", (chunk) => {
      if (tooLarge) return;
      raw += chunk;
      if (Buffer.byteLength(raw) > maxBytes) {
        tooLarge = true;
        raw = "";
      }
    });
    req.on("end", () => {
      if (tooLarge) {
        const error = new Error("Request body is too large");
        error.statusCode = 413;
        reject(error);
        return;
      }
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
  });
}

function getBearer(req) {
  const header = req.headers.authorization || "";
  return header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
}

async function requireAuth(req, res) {
  const token = getBearer(req);
  const session = getAccessSession(token);
  if (session && !(await pairingStore.isDeviceRevoked(session.deviceId))) {
    req.authSession = session;
    return true;
  }
  sendJson(res, 401, { error: "Session expired. Sign in again or pair this phone once more." });
  return false;
}

function clientIp(req) {
  return String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "").split(",")[0].trim();
}

function requestOrigin(req) {
  const proto = req.headers["x-forwarded-proto"] || (req.socket?.encrypted ? "https" : "http");
  return `${proto}://${req.headers.host || `${HOST}:${PORT}`}`;
}

function broadcast(type, payload = {}) {
  const message = JSON.stringify({ type, payload, at: new Date().toISOString() });
  for (const client of clients.keys()) {
    if (client.readyState === client.OPEN) client.send(message);
  }
}

function revokeDeviceConnections(deviceId) {
  for (const [client, session] of clients.entries()) {
    if (session.deviceId === deviceId && client.readyState === client.OPEN) {
      client.send(JSON.stringify({ type: "security.device-revoked", payload: { deviceId }, at: new Date().toISOString() }));
      client.close(4001, "Trusted device revoked");
    }
  }
}

function mergeMessages(...messageLists) {
  const byId = new Set();
  const byContent = new Map();
  const output = [];
  const sorted = messageLists.flat().filter(Boolean).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  for (const message of sorted) {
    if (message.id && byId.has(message.id)) continue;
    if (message.id) byId.add(message.id);
    const text = String(message.text || message.outputPreview || "").replace(/\s+/g, " ").trim();
    const contentKey = text && ["message", "run_state"].includes(message.kind || "") ? `${message.threadId || ""}:${message.role}:${message.kind}:${text}` : "";
    const existing = contentKey ? byContent.get(contentKey) : null;
    if (existing) {
      const previousAt = new Date(existing.message.createdAt).getTime();
      const nextAt = new Date(message.createdAt).getTime();
      const windowMs = message.role === "user" ? (text.length >= 12 ? 8000 : 2500) : message.role === "assistant" ? (text.length >= 24 ? 15 * 60 * 1000 : 120000) : 5000;
      if (!Number.isFinite(previousAt) || !Number.isFinite(nextAt) || Math.abs(nextAt - previousAt) <= windowMs) {
        const preferred = nextAt >= previousAt ? message : existing.message;
        output[existing.index] = preferred;
        byContent.set(contentKey, { index: existing.index, message: preferred });
        continue;
      }
    }
    const index = output.length;
    output.push(message);
    if (contentKey) byContent.set(contentKey, { index, message });
  }
  return output.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
}

function walkThreads(threads, visitor) {
  for (const thread of threads || []) {
    visitor(thread);
    if (Array.isArray(thread.subagents) && thread.subagents.length) walkThreads(thread.subagents, visitor);
  }
}

function markThreadHot(thread) {
  if (!thread?.id || !thread.rolloutPath) return;
  hotThreads.set(thread.id, {
    id: thread.id,
    cwd: thread.cwd || "",
    rolloutPath: thread.rolloutPath,
    expiresAt: Date.now() + HOT_THREAD_TTL_MS
  });
}

function listHotThreads() {
  const now = Date.now();
  const threads = [];
  for (const [threadId, thread] of hotThreads.entries()) {
    if (!thread?.rolloutPath || thread.expiresAt <= now) {
      hotThreads.delete(threadId);
      continue;
    }
    threads.push(thread);
  }
  return threads;
}

function broadcastRolloutChange(change) {
  appServerMessagesCache.delete(change.threadId);
  broadcast("thread.updated", change);
  broadcast("project.updated", { cwd: change.cwd });
}

async function loadAppServerMessages(threadId) {
  const cached = appServerMessagesCache.get(threadId) || [];
  try {
    const messages = await Promise.race([
      appServerClient.threadMessages(threadId),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error("threadMessages timed out")), APP_SERVER_MESSAGE_TIMEOUT_MS).unref();
      })
    ]);
    appServerMessagesCache.set(threadId, messages);
    return messages;
  } catch {
    return cached;
  }
}

async function waitForIndexedThread(thread, timeoutMs = THREAD_START_INDEX_TIMEOUT_MS) {
  if (!thread?.id) return thread;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const indexed = await getThread(thread.id);
    if (indexed) return { ...indexed, title: indexed.title || thread.title || "New Chat" };
    await new Promise((resolve) => setTimeout(resolve, THREAD_START_INDEX_POLL_MS));
  }
  return thread;
}

async function loadMergedThreadMessages(thread) {
  const [rolloutMessages, appServerMessages] = await Promise.all([
    getMessagesForThread(thread),
    loadAppServerMessages(thread.id)
  ]);
  return {
    rolloutMessages: rolloutMessages || [],
    messages: mergeMessages(rolloutMessages || [], appServerMessages)
  };
}

async function loadThreadDetailPayload(threadId, manager, options = {}) {
  const thread = await getThread(threadId);
  if (!thread) return null;
  markThreadHot(thread);
  const { rolloutMessages, messages } = await loadMergedThreadMessages(thread);
  const state = inferDesktopState(threadId, rolloutMessages, manager.getState(threadId));
  return {
    thread: { ...thread, effectiveModel: manager.getModel(threadId, thread.model), runtime: manager.getRuntime(threadId) },
    state,
    followUps: manager.listFollowUps(threadId),
    subagents: listSubagentsForThread(thread),
    ...selectThreadConversationWindow(messages, options)
  };
}

async function codexCliAvailable() {
  return new Promise((resolve) => {
    try {
      execFile(resolveCodexCliCommand(), ["--version"], { env: codexProcessEnv(), timeout: 5000 }, (error, stdout) => {
        resolve({ available: !error, version: stdout.trim(), error: error?.message || "" });
      });
    } catch (error) {
      resolve({ available: false, version: "", error: error?.message || "Unable to run codex --version" });
    }
  });
}

async function inspectAppServer({ deep = false } = {}) {
  let connectError = "";
  let timedOut = false;
  if (deep && CODEX_SEND_MODE === "desktop") {
    const connectPromise = appServerClient.ensureConnected();
    connectPromise.catch(() => {});
    const timeoutPromise = new Promise((resolve) => {
      const timer = setTimeout(() => resolve({ timedOut: true }), 4500);
      timer.unref?.();
    });
    const result = await Promise.race([
      connectPromise.then(() => ({ ok: true })).catch((error) => ({ error })),
      timeoutPromise
    ]);
    timedOut = Boolean(result.timedOut);
    connectError = result.error?.message || (timedOut ? "Desktop bridge connection took longer than 4.5 seconds" : "");
  }
  return { ...appServerClient.status(), checked: deep, timedOut, error: connectError };
}

function buildAppServerCheck(appServer) {
  if (CODEX_SEND_MODE !== "desktop") {
    return makeDiagnosticCheck({
      id: "desktop-bridge",
      label: "Desktop bridge",
      status: "ok",
      detail: `Current send mode is ${CODEX_SEND_MODE}; desktop bridge is not required.`
    });
  }
  if (appServer.connected && appServer.initialized) {
    return makeDiagnosticCheck({
      id: "desktop-bridge",
      label: "Desktop bridge",
      status: "ok",
      detail: "Connected to Codex app-server."
    });
  }
  return makeDiagnosticCheck({
    id: "desktop-bridge",
    label: "Desktop bridge",
    status: appServer.checked && appServer.error ? "error" : "warning",
    detail: appServer.error || "Not connected yet; first send or diagnostics can reconnect.",
    action: "Keep Codex Desktop open, then retry from the phone."
  });
}

function checksHaveStoreError(checks = []) {
  return Array.isArray(checks) && checks.some((check) => check?.status === "error");
}

async function buildSystemStatus(manager, { deep = false } = {}) {
  const [storeStatus, codexCli, auth, publicLink, appServer, deviceSecurity] = await Promise.all([
    getSystemStatus(manager.getActiveStates()),
    codexCliAvailable(),
    passwordStatus(),
    readCurrentPhoneLink(),
    inspectAppServer({ deep }),
    pairingStore.diagnostics()
  ]);
  const localUrl = publicLink.localUrl || `http://${HOST}:${PORT}/`;
  const publicUrl = publicLink.phoneUrl || "";
  const bridgeState = !auth.configured
    ? "degraded"
    : checksHaveStoreError(storeStatus.checks)
      ? "degraded"
      : publicLink.failureReason
        ? "recovering"
        : "ready";
  const runtimeChecks = [
    makeDiagnosticCheck({ id: "http-service", label: "Computer web service", status: "ok", detail: `Running at ${localUrl}` }),
    makeDiagnosticCheck({
      id: "public-link",
      label: "Phone public link",
      status: publicUrl && !publicLink.failureReason ? "ok" : "warning",
      detail: publicUrl
        ? `${publicUrl}${publicLink.tunnelType ? ` via ${publicLink.tunnelType}` : ""}${publicLink.updatedAt ? `, generated at ${publicLink.updatedAt}` : ""}`
        : publicLink.error || "No phone public link has been generated yet.",
      action: publicLink.failureReason || (publicUrl ? "" : "Restart the public link helper or use Tailscale/LAN."),
      meta: { tunnelType: publicLink.tunnelType || "", stable: Boolean(publicLink.stable), failureReason: publicLink.failureReason || "" }
    }),
    makeDiagnosticCheck({
      id: "auth",
      label: "Access password",
      status: auth.configured ? "ok" : "error",
      detail: auth.configured
        ? auth.environmentPasswordIgnored
          ? "Using the saved local password. CODEX_REMOTE_PASSWORD in .env is ignored until the saved password is changed or cleared."
          : `Configured from ${auth.source}`
        : "No access password configured yet.",
      action: auth.configured
        ? auth.environmentPasswordIgnored
          ? "Use Password settings in the web page to change the active password."
          : ""
        : "Set a password on the first web visit."
    }),
    makeDiagnosticCheck({
      id: "trusted-devices",
      label: "Trusted devices",
      status: deviceSecurity.trustedDevices ? "ok" : "warning",
      detail: `${deviceSecurity.trustedDevices} trusted, ${deviceSecurity.revokedDevices} revoked, ${deviceSecurity.activePairingSessions} active pairing code(s).`,
      action: deviceSecurity.trustedDevices ? "" : "Pair your phone once from the Advanced panel."
    }),
    makeDiagnosticCheck({
      id: "websocket",
      label: "Realtime sync",
      status: clients.size ? "ok" : "warning",
      detail: clients.size ? `${clients.size} web page(s) connected.` : "No realtime web page connection is active.",
      action: clients.size ? "" : "Refresh the phone page."
    }),
    makeDiagnosticCheck({
      id: "codex-cli",
      label: "Codex command",
      status: codexCli.available ? "ok" : "error",
      detail: codexCli.available ? codexCli.version || "codex is runnable" : codexCli.error || "codex command was not found.",
      action: codexCli.available ? "" : "Reinstall dependencies or check CODEX_CLI_PATH."
    }),
    buildAppServerCheck(appServer)
  ];
  const checks = [...runtimeChecks, ...(storeStatus.checks || [])];
  const diagnostics = { ...summarizeDiagnosticChecks(checks), checks, checkedAt: new Date().toISOString(), deep };
  return {
    ...storeStatus,
    sendMode: CODEX_SEND_MODE,
    model: manager.getModel(),
    runtime: runtimePublicPayload({ defaults: manager.getRuntime(), sendMode: CODEX_SEND_MODE }),
    codexCli,
    appServer,
    serviceState: bridgeState,
    bridge: {
      platform: "windows-node-bridge",
      state: bridgeState,
      responsibilities: [
        "HTTP API and PWA static resources",
        "WebSocket realtime sync",
        "Codex Desktop / CLI / app-server send routing",
        "trusted devices, pairing, tokens, and audit",
        "Git status and confirmed safe actions",
        "thread-scoped uploads and diagnostics",
        "LAN/Tailscale/temporary tunnel phone links"
      ]
    },
    auth,
    tokenDiagnostics: tokenDiagnostics(),
    deviceSecurity,
    webClients: clients.size,
    localUrl,
    publicUrl,
    publicLink,
    pwaVersion: PWA_VERSION,
    checks,
    diagnostics,
    overall: diagnostics.overall
  };
}

async function serveStatic(req, res, pathname) {
  const requested = pathname === "/" || pathname === "/pair" ? "index.html" : pathname.slice(1);
  const filePath = path.resolve(distDir, requested);
  if (!filePath.startsWith(distDir)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  try {
    const stat = await fsp.stat(filePath);
    const target = stat.isDirectory() ? path.join(filePath, "index.html") : filePath;
    res.writeHead(200, {
      "Content-Type": contentType(target),
      "Cache-Control": cacheControlForStatic(target),
      "X-Codex-Build-Id": BUILD_ID
    });
    fs.createReadStream(target).pipe(res);
  } catch {
    const indexPath = path.join(distDir, "index.html");
    if (fs.existsSync(indexPath)) {
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
        "X-Codex-Build-Id": BUILD_ID
      });
      fs.createReadStream(indexPath).pipe(res);
      return;
    }
    res.writeHead(404);
    res.end("Build the PWA with npm run build, or run npm run dev for Vite.");
  }
}

function cacheControlForStatic(filePath) {
  if (filePath.endsWith(".html")) return "no-store, no-cache, must-revalidate, max-age=0";
  if (filePath.includes(`${path.sep}assets${path.sep}`)) return "no-store, no-cache, must-revalidate, max-age=0";
  if (filePath.endsWith("sw.js")) return "no-store, no-cache, must-revalidate, max-age=0";
  return "no-cache, max-age=0";
}

function contentType(filePath) {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".svg")) return "image/svg+xml";
  if (filePath.endsWith(".webmanifest")) return "application/manifest+json";
  return "application/octet-stream";
}

function modelPayload(manager, thread = null) {
  const model = manager.getModel(thread?.id || null, thread?.model || "");
  return { model, availableModels: Array.from(new Set([model, ...AVAILABLE_MODELS])) };
}

function normalizeCreatedThread(thread, fallbackCwd = "") {
  if (!thread || typeof thread !== "object") return null;
  const id = thread.id || thread.threadId || thread.sessionId || "";
  if (!id) return null;
  const cwd = thread.cwd || thread.projectCwd || fallbackCwd || "";
  return {
    ...thread,
    id,
    cwd,
    projectCwd: cwd || thread.projectCwd || "",
    title: thread.title || thread.name || "New Chat",
    updatedAt: thread.updatedAt || thread.updated_at || new Date().toISOString(),
    createdAt: thread.createdAt || thread.created_at || new Date().toISOString(),
    subagents: Array.isArray(thread.subagents) ? thread.subagents : []
  };
}

async function createThreadFromAppServer(manager, body = {}) {
  const cwd = String(body.cwd || body.projectCwd || "").trim();
  const response = await appServerClient.startThread({
    cwd: cwd || null,
    model: manager.getModel(null) || CODEX_REMOTE_MODEL
  });
  const thread = normalizeCreatedThread(response?.thread || response, cwd);
  if (!thread) throw new Error("thread/start response missing thread");
  const indexedThread = await waitForIndexedThread(thread);
  markThreadHot(indexedThread);
  return { ok: true, mode: "app-server", thread: indexedThread, response };
}

export async function createApiHandler({ runManagerInstance = runManager } = {}) {
  return async function apiHandler(req, res) {
    try {
      const url = new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`);
      if (url.pathname.startsWith("/api/")) {
        await handleApi(req, res, url.pathname, url.searchParams, runManagerInstance);
        return;
      }
      await serveStatic(req, res, url.pathname);
    } catch (error) {
      sendJson(res, error.statusCode || 500, { error: error.message || "Internal server error" });
    }
  };
}

const server = http.createServer(await createApiHandler());

async function handleApi(req, res, pathname, searchParams, manager) {
  if (req.method === "GET" && pathname === "/api/client-meta") {
    sendJson(res, 200, { buildId: BUILD_ID, pwaVersion: PWA_VERSION });
    return;
  }

  if (req.method === "GET" && (pathname === "/api/mobile/bootstrap" || pathname === "/api/mobile/v1/bootstrap")) {
    const token = getBearer(req);
    if (token && validateAccessToken(token)) {
      const session = getAccessSession(token);
      if (session?.deviceId && await pairingStore.isDeviceRevoked(session.deviceId)) {
        revokeTokensForDevice(session.deviceId);
      } else {
        req.authSession = session || {};
      }
    }
    sendJson(res, 200, await mobileBootstrapPayload(req, manager));
    return;
  }

  if (req.method === "GET" && pathname === "/api/auth/status") {
    sendJson(res, 200, await passwordStatus());
    return;
  }

  if (req.method === "POST" && pathname === "/api/auth/setup") {
    const status = await passwordStatus();
    if (!status.setupRequired) {
      sendJson(res, 409, { error: "Password is already configured" });
      return;
    }
    const body = await readBody(req);
    await setPassword(body.password);
    revokeAllTokens();
    sendJson(res, 201, issueTokenPair({ authMethod: "password", trustLevel: "password" }));
    return;
  }

  if (req.method === "POST" && pathname === "/api/auth/login") {
    const body = await readBody(req);
    const status = await passwordStatus();
    if (status.setupRequired) {
      sendJson(res, 428, { error: "Create a password before logging in", setupRequired: true });
      return;
    }
    if (!(await verifyPassword(body.password))) {
      sendJson(res, 401, { error: "Wrong password" });
      return;
    }
    sendJson(res, 200, issueTokenPair({ authMethod: "password", trustLevel: "password" }));
    return;
  }

  if (req.method === "POST" && pathname === "/api/auth/device-login") {
    const body = await readBody(req);
    const device = await pairingStore.verifyDevice({
      deviceId: body.deviceId,
      deviceToken: body.deviceToken,
      fingerprint: body.fingerprint,
      ip: clientIp(req),
      userAgent: req.headers["user-agent"] || ""
    });
    if (!device) {
      sendJson(res, 401, { error: "Trusted device was revoked or not recognized. Use the password or pair again." });
      return;
    }
    sendJson(res, 200, { ...issueTokenPair({ deviceId: device.id, authMethod: "trusted-device", trustLevel: device.permissionLevel }), device });
    return;
  }

  if (req.method === "POST" && pathname === "/api/auth/refresh") {
    const body = await readBody(req);
    const refreshed = refreshAccessToken(body.refreshToken);
    if (!refreshed) {
      sendJson(res, 401, { error: "Invalid refresh token" });
      return;
    }
    if (refreshed.deviceId && await pairingStore.isDeviceRevoked(refreshed.deviceId)) {
      revokeTokensForDevice(refreshed.deviceId);
      sendJson(res, 401, { error: "Trusted device was revoked." });
      return;
    }
    sendJson(res, 200, refreshed);
    return;
  }

  if (req.method === "POST" && pathname === "/api/pairing/complete") {
    const body = await readBody(req);
    const result = await pairingStore.completePairing({
      code: body.code,
      deviceName: body.deviceName,
      fingerprint: body.fingerprint,
      ip: clientIp(req),
      userAgent: req.headers["user-agent"] || ""
    });
    sendJson(res, 201, {
      device: result.device,
      deviceToken: result.deviceToken,
      tokens: issueTokenPair({ deviceId: result.device.id, authMethod: "pairing", trustLevel: result.device.permissionLevel })
    });
    return;
  }

  if (!(await requireAuth(req, res))) return;

  if (req.method === "POST" && pathname === "/api/auth/password") {
    const body = await readBody(req);
    if (!(await verifyPassword(body.currentPassword))) {
      sendJson(res, 401, { error: "Current password is wrong" });
      return;
    }
    await setPassword(body.newPassword);
    revokeAllTokens();
    sendJson(res, 200, issueTokenPair({ authMethod: "password", trustLevel: "password" }));
    return;
  }

  if (req.method === "POST" && pathname === "/api/pairing/session") {
    const body = await readBody(req);
    sendJson(res, 201, await pairingStore.createPairingSession({
      origin: requestOrigin(req),
      permissionLevel: body.permissionLevel,
      createdBy: req.authSession?.authMethod || "password",
      ip: clientIp(req)
    }));
    return;
  }

  if (pathname === "/api/devices") {
    if (req.method === "GET") {
      sendJson(res, 200, { devices: await pairingStore.listDevices() });
      return;
    }
    if (req.method === "PATCH") {
      const body = await readBody(req);
      sendJson(res, 200, { device: await pairingStore.renameDevice(body.deviceId, body.name) });
      return;
    }
    if (req.method === "DELETE") {
      const body = await readBody(req);
      const device = await pairingStore.revokeDevice(body.deviceId, { ip: clientIp(req), userAgent: req.headers["user-agent"] || "" });
      revokeTokensForDevice(body.deviceId);
      revokeDeviceConnections(body.deviceId);
      sendJson(res, 200, { device });
      return;
    }
  }

  if (req.method === "GET" && pathname === "/api/security/audit") {
    sendJson(res, 200, { audit: await pairingStore.auditLog() });
    return;
  }

  if (req.method === "GET" && pathname === "/api/projects") {
    sendJson(res, 200, await listProjects());
    return;
  }

  if (req.method === "GET" && pathname === "/api/threads") {
    sendJson(res, 200, await listThreads(searchParams.get("project") || ""));
    return;
  }

  if (req.method === "POST" && pathname === "/api/uploads") {
    const body = await readBody(req, { maxBytes: UPLOAD_JSON_BODY_LIMIT });
    const files = Array.isArray(body.files) ? body.files : [];
    if (!files.length) {
      sendJson(res, 400, { error: "No files uploaded" });
      return;
    }
    const uploads = [];
    for (const file of files) uploads.push(await saveBase64Upload(file));
    sendJson(res, 201, { uploads });
    return;
  }

  if (pathname === "/api/runtime/defaults") {
    if (req.method === "GET") {
      sendJson(res, 200, runtimePublicPayload({ defaults: manager.getRuntime(), sendMode: CODEX_SEND_MODE }));
      return;
    }
    if (req.method === "POST") {
      const body = await readBody(req);
      sendJson(res, 200, runtimePublicPayload({ defaults: manager.setRuntime(body.controls || body), sendMode: CODEX_SEND_MODE }));
      return;
    }
  }

  const threadRuntimeMatch = pathname.match(/^\/api\/threads\/([^/]+)\/runtime$/);
  if (threadRuntimeMatch) {
    const threadId = decodeURIComponent(threadRuntimeMatch[1]);
    if (req.method === "GET") {
      sendJson(res, 200, runtimePublicPayload({ defaults: manager.getRuntime(), thread: manager.getRuntime(threadId), sendMode: CODEX_SEND_MODE }));
      return;
    }
    if (req.method === "POST") {
      const body = await readBody(req);
      sendJson(res, 200, runtimePublicPayload({ defaults: manager.getRuntime(), thread: manager.setRuntime(body.controls || body, threadId), sendMode: CODEX_SEND_MODE }));
      return;
    }
  }

  const followMatch = pathname.match(/^\/api\/threads\/([^/]+)\/followups(?:\/([^/]+))?$/);
  if (followMatch) {
    const threadId = decodeURIComponent(followMatch[1]);
    const followId = followMatch[2] ? decodeURIComponent(followMatch[2]) : "";
    if (req.method === "GET") {
      sendJson(res, 200, { followUps: manager.listFollowUps(threadId), state: manager.getState(threadId) });
      return;
    }
    const body = await readBody(req);
    if (req.method === "POST" && !followId) {
      sendJson(res, 202, { followUp: manager.enqueueFollowUp(threadId, body.message || body.prompt || "", body.runtime || {}), state: manager.getState(threadId), steerActiveRun: false });
      return;
    }
    if (req.method === "PATCH" && followId) {
      if (body.direction || body.move) {
        sendJson(res, 200, { followUp: manager.reorderFollowUp(threadId, followId, body.direction || body.move), followUps: manager.listFollowUps(threadId), state: manager.getState(threadId) });
        return;
      }
      sendJson(res, 200, { followUp: manager.updateFollowUp(threadId, followId, body), state: manager.getState(threadId) });
      return;
    }
    if (req.method === "DELETE" && followId) {
      sendJson(res, 200, { followUp: manager.cancelFollowUp(threadId, followId), state: manager.getState(threadId) });
      return;
    }
  }

  const subagentMatch = pathname.match(/^\/api\/threads\/([^/]+)\/subagents$/);
  if (subagentMatch) {
    const threadId = decodeURIComponent(subagentMatch[1]);
    const thread = await getThread(threadId);
    if (!thread) {
      sendJson(res, 404, { error: "Thread not found" });
      return;
    }
    if (req.method === "GET") {
      sendJson(res, 200, { subagents: listSubagentsForThread(thread), mode: "native-if-present-command-fallback" });
      return;
    }
    if (req.method === "POST") {
      const body = await readBody(req);
      const record = createSubagentRecord(threadId, body);
      const command = buildSubagentCommand(record);
      const state = await manager.send(threadId, command, { queueIfRunning: true, runtime: body.runtime || {} });
      sendJson(res, 202, { subagent: record, commandMode: true, state });
      return;
    }
  }

  if (pathname === "/api/git/status" && req.method === "GET") {
    const threadId = searchParams.get("threadId") || "";
    const thread = await getThread(threadId);
    if (!thread) {
      sendJson(res, 404, { error: "Thread not found" });
      return;
    }
    sendJson(res, 200, { status: await gitStatus(thread.cwd), branches: await gitBranches(thread.cwd).catch(() => []), help: gitActionHelp() });
    return;
  }

  if (pathname === "/api/git/action" && req.method === "POST") {
    const body = await readBody(req);
    const thread = await getThread(body.threadId);
    if (!thread) {
      sendJson(res, 404, { error: "Thread not found" });
      return;
    }
    sendJson(res, 200, await runGitAction(thread.cwd, body.action, body));
    return;
  }

  if (pathname === "/api/threads/new" && req.method === "POST") {
    const body = await readBody(req);
    sendJson(res, 201, await createThreadFromAppServer(manager, body));
    return;
  }

  if (pathname === "/api/threads/new/open-desktop" && req.method === "POST") {
    sendJson(res, 200, await openCodexNewThreadInDesktop());
    return;
  }

  const threadMatch = pathname.match(/^\/api\/threads\/([^/]+)(?:\/([^/]+))?$/);
  if (threadMatch) {
    const threadId = decodeURIComponent(threadMatch[1]);
    const action = threadMatch[2] || "";

    if (req.method === "GET" && !action) {
      const thread = await getThread(threadId);
      if (!thread) {
        sendJson(res, 404, { error: "Thread not found" });
        return;
      }
      markThreadHot(thread);
      const messages = await getMessagesForThread(thread);
      const state = inferDesktopState(threadId, messages || [], manager.getState(threadId));
      sendJson(res, 200, { thread: { ...thread, effectiveModel: manager.getModel(threadId, thread.model), runtime: manager.getRuntime(threadId) }, state });
      return;
    }

    if (req.method === "GET" && action === "detail") {
      const detail = await loadThreadDetailPayload(threadId, manager, {
        afterMessageId: searchParams.get("after") || "",
        beforeMessageId: searchParams.get("before") || "",
        limit: normalizeThreadDetailLimit(searchParams.get("limit") || "", DEFAULT_THREAD_DETAIL_LIMIT)
      });
      if (!detail) {
        sendJson(res, 404, { error: "Thread not found" });
        return;
      }
      sendJson(res, 200, detail);
      return;
    }

    if (action === "model") {
      const thread = await getThread(threadId);
      if (!thread) {
        sendJson(res, 404, { error: "Thread not found" });
        return;
      }
      if (req.method === "GET") {
        sendJson(res, 200, modelPayload(manager, thread));
        return;
      }
      if (req.method === "POST") {
        const body = await readBody(req);
        manager.setModel(body.model, threadId);
        sendJson(res, 200, modelPayload(manager, thread));
        return;
      }
    }

    if (req.method === "GET" && action === "messages") {
      const thread = await getThread(threadId);
      if (!thread) {
        sendJson(res, 404, { error: "Thread not found" });
        return;
      }
      markThreadHot(thread);
      const { messages } = await loadMergedThreadMessages(thread);
      sendJson(res, 200, selectVisibleConversationMessages(messages));
      return;
    }

    if (req.method === "POST" && action === "send") {
      const body = await readBody(req);
      appServerMessagesCache.delete(threadId);
      markThreadHot(await getThread(threadId));
      const state = await manager.send(threadId, formatPromptWithAttachments(body.message || "", body.attachments || []), {
        runtime: body.runtime || {},
        queueIfRunning: body.queueIfRunning !== false
      });
      sendJson(res, 202, state);
      return;
    }

    if (req.method === "POST" && action === "cancel") {
      appServerMessagesCache.delete(threadId);
      markThreadHot(await getThread(threadId));
      sendJson(res, 200, await manager.cancel(threadId));
      return;
    }

    if (req.method === "POST" && action === "retry") {
      appServerMessagesCache.delete(threadId);
      markThreadHot(await getThread(threadId));
      const state = await manager.retry(threadId);
      sendJson(res, 202, state);
      return;
    }

    if (req.method === "POST" && action === "open-desktop") {
      const thread = await getThread(threadId);
      if (!thread) {
        sendJson(res, 404, { error: "Thread not found" });
        return;
      }
      markThreadHot(thread);
      sendJson(res, 200, await openCodexThreadInDesktop(threadId));
      return;
    }
  }

  if (req.method === "GET" && pathname === "/api/system/status") {
    sendJson(res, 200, await buildSystemStatus(manager, { deep: searchParams.get("deep") === "1" }));
    return;
  }

  if (req.method === "GET" && pathname === "/api/system/diagnostics") {
    const status = await buildSystemStatus(manager, { deep: true });
    sendJson(res, 200, {
      checkedAt: status.diagnostics.checkedAt,
      serviceState: status.serviceState,
      overall: status.diagnostics.overall,
      summary: status.diagnostics,
      checks: status.checks,
      bridge: status.bridge,
      publicLink: status.publicLink,
      tokenDiagnostics: status.tokenDiagnostics,
      deviceSecurity: status.deviceSecurity,
      pwaVersion: status.pwaVersion,
      sendMode: status.sendMode
    });
    return;
  }

  if (pathname === "/api/system/model") {
    if (req.method === "GET") {
      sendJson(res, 200, modelPayload(manager));
      return;
    }
    if (req.method === "POST") {
      const body = await readBody(req);
      manager.setModel(body.model);
      sendJson(res, 200, modelPayload(manager));
      return;
    }
  }

  sendJson(res, 404, { error: "Not found" });
}

const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", async (req, socket, head) => {
  const url = new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`);
  const token = url.searchParams.get("token");
  const session = getAccessSession(token);
  if (url.pathname !== "/ws" || !validateAccessToken(token) || (session?.deviceId && await pairingStore.isDeviceRevoked(session.deviceId))) {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    clients.set(ws, session || {});
    ws.send(JSON.stringify({ type: "system.connected", payload: { codexHome: CODEX_HOME, pwaVersion: PWA_VERSION }, at: new Date().toISOString() }));
    ws.on("close", () => clients.delete(ws));
  });
});

for (const eventName of ["status", "model.changed", "runtime.changed", "followup.queued", "followup.updated", "followup.cancelled", "followup.reordered", "run.started", "run.finished", "run.failed", "run.event", "run.output"]) {
  runManager.on(eventName, (payload) => {
    const type = eventName === "status" ? "thread.status" : eventName;
    broadcast(type, payload);
  });
}

appServerClient.on("notification", (message) => {
  const { method, params } = message;
  if (method === "turn/completed") {
    appServerMessagesCache.delete(params.threadId);
    runManager.completeAppServerTurn(params.threadId, params.turn, params.turn?.status === "failed");
    broadcast("thread.updated", { threadId: params.threadId });
    return;
  }
  if (method === "error") {
    appServerMessagesCache.delete(params.threadId);
    runManager.completeAppServerTurn(params.threadId, { id: params.turnId, status: "failed" }, true);
    broadcast("run.failed", { threadId: params.threadId, turnId: params.turnId, error: params.error });
    return;
  }
  if (method === "item/agentMessage/delta") return;
  if (method === "thread/status/changed") {
    broadcast("thread.status", { threadId: params.threadId, state: runManager.getState(params.threadId), appStatus: params.status });
  }
});

let lastStateMtime = 0;
let rolloutMtimes = new Map();

setInterval(async () => {
  try {
    const stat = await fsp.stat(codexPath("state_5.sqlite"));
    if (stat.mtimeMs !== lastStateMtime) {
      lastStateMtime = stat.mtimeMs;
      broadcast("project.updated");
      broadcast("thread.updated");
    }
  } catch {}
}, 2000).unref();

setInterval(async () => {
  try {
    const threads = listHotThreads();
    if (!threads.length) return;
    for (const thread of threads) {
      try {
        const stat = await fsp.stat(thread.rolloutPath);
        const previousMtime = rolloutMtimes.get(thread.rolloutPath);
        rolloutMtimes.set(thread.rolloutPath, stat.mtimeMs);
        if (Number.isFinite(previousMtime) && previousMtime !== stat.mtimeMs) {
          broadcastRolloutChange({ threadId: thread.id, cwd: thread.cwd, rolloutPath: thread.rolloutPath });
        }
      } catch {}
    }
  } catch {}
}, HOT_THREAD_POLL_MS).unref();

setInterval(async () => {
  try {
    const threads = await listThreads();
    const mtimes = new Map();
    const threadList = [];
    walkThreads(threads, (thread) => threadList.push(thread));
    await Promise.all(threadList.map(async (thread) => {
      if (!thread.rolloutPath) return;
      try {
        const stat = await fsp.stat(thread.rolloutPath);
        mtimes.set(thread.rolloutPath, stat.mtimeMs);
      } catch {}
    }));
    const result = detectRolloutChanges(rolloutMtimes, threads, mtimes);
    rolloutMtimes = result.next;
    for (const change of result.changed) broadcastRolloutChange(change);
  } catch {}
}, FULL_ROLLOUT_SCAN_MS).unref();

server.listen(PORT, HOST, () => {
  passwordStatus()
    .then((status) => {
      if (status.setupRequired) console.warn("No remote password is configured; the first web visit must create one.");
      if (!isLoopbackHost(HOST) && status.setupRequired) console.warn("Non-loopback serving is waiting for first-run password setup.");
    })
    .catch(() => {});
  console.log(`Codex mobile workbench listening on http://${HOST}:${PORT}`);
});
