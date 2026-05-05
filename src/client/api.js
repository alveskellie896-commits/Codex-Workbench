import { humanizeError } from "./errorMessages.js";

const TOKEN_KEY = "codex.workbench.tokens";
const TRUSTED_DEVICE_KEY = "codex.workbench.trustedDevice";
const REQUEST_TIMEOUT_MS = 25000;

export class ApiError extends Error {
  constructor(message, { statusCode = 0, retryable = false } = {}) {
    const humanized = humanizeError(message, { statusCode, retryable });
    super(humanized.message);
    this.name = "ApiError";
    this.statusCode = statusCode;
    this.retryable = retryable;
    this.rawMessage = humanized.raw || message || "";
    this.userMessage = humanized.message;
  }
}

export function loadStoredTokens() {
  try {
    const raw = localStorage.getItem(TOKEN_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function storeTokens(tokens) {
  localStorage.setItem(TOKEN_KEY, JSON.stringify(tokens));
}

export function clearTokens() {
  localStorage.removeItem(TOKEN_KEY);
}

export function loadTrustedDevice() {
  try {
    const raw = localStorage.getItem(TRUSTED_DEVICE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function storeTrustedDevice(device) {
  if (!device?.deviceId || !device?.deviceToken) return;
  localStorage.setItem(TRUSTED_DEVICE_KEY, JSON.stringify(device));
}

export function clearTrustedDevice() {
  localStorage.removeItem(TRUSTED_DEVICE_KEY);
}

export function browserFingerprint() {
  if (typeof window === "undefined" || typeof navigator === "undefined") return "server";
  const screenInfo = window.screen || {};
  return [
    navigator.userAgent || "",
    navigator.platform || "",
    navigator.language || "",
    screenInfo.width || "",
    screenInfo.height || "",
    Intl.DateTimeFormat().resolvedOptions().timeZone || ""
  ].join("|");
}

function encodeQuery(params) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") search.set(key, value);
  });
  const value = search.toString();
  return value ? `?${value}` : "";
}

function retryableStatus(status) {
  return [408, 409, 425, 429].includes(status) || status >= 500;
}

function withThreadScope(files = [], threadId = "") {
  return files.map((file) => {
    if (!threadId || file?.threadId) return file;
    return { ...file, threadId };
  });
}

export class ApiClient {
  constructor({ getAccessToken, getRefreshToken, onTokenRefresh, onUnauthorized }) {
    this.getAccessToken = getAccessToken;
    this.getRefreshToken = getRefreshToken;
    this.onTokenRefresh = onTokenRefresh;
    this.onUnauthorized = onUnauthorized;
  }

  async request(path, options = {}) {
    return this.requestWithToken(path, options, true);
  }

  requestContext(path) {
    if (path.startsWith("/api/uploads")) return "upload";
    if (path.startsWith("/api/auth")) return "auth";
    if (path.includes("/send")) return "send";
    return "api";
  }

  networkErrorMessage(path, error) {
    const context = this.requestContext(path);
    const message = error?.message || "";
    if (message === "Load failed" || message === "Failed to fetch" || message === "NetworkError when attempting to fetch resource.") {
      if (context === "upload") return "上传失败。文件可能过大，或手机与电脑连接中断�?;
      if (context === "auth") return "无法连接�?CODEX WORKBENCH Host Service。请确认电脑端服务正在运行，并且手机和电脑在同一网络�?;
      if (context === "send") return "发送失败。请确认电脑端服务仍在运行，且当前线程没有断开�?;
      return "网络请求失败。请确认电脑端服务正在运行，并且手机和电脑在同一网络�?;
    }
    return message || "Network request failed";
  }

  async requestWithToken(path, options = {}, allowRefresh) {
    const token = this.getAccessToken();
    const headers = new Headers(options.headers);
    headers.set("Accept", "application/json");
    if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    if (token) headers.set("Authorization", `Bearer ${token}`);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs || REQUEST_TIMEOUT_MS);
    let response;
    try {
      response = await fetch(path, { ...options, headers, signal: options.signal || controller.signal });
    } catch (error) {
      const message =
        error?.name === "AbortError"
          ? "Request timed out; auto-retry is waiting"
          : error?.message === "Load failed"
            ? "Network interrupted; auto-retry is waiting"
            : error?.message || "Network request failed";
      throw new ApiError(message, { retryable: true });
    } finally {
      clearTimeout(timeout);
    }

    if (response.status === 401 && allowRefresh) {
      let refreshed = false;
      try {
        refreshed = await this.refresh();
      } catch (error) {
        if (error?.retryable) throw error;
      }
      if (refreshed) return this.requestWithToken(path, options, false);
    }

    if (response.status === 401) {
      this.onUnauthorized?.();
      throw new ApiError("Session expired. Please sign in again.", { statusCode: 401, retryable: false });
    }

    const contentType = response.headers.get("content-type") || "";
    const payload = contentType.includes("application/json") ? await response.json() : await response.text();

    if (!response.ok) {
      const message = typeof payload === "object" ? payload.error || payload.message : payload;
      throw new ApiError(message || `Request failed with status ${response.status}`, {
        statusCode: response.status,
        retryable: retryableStatus(response.status)
      });
    }

    return payload;
  }

  async refresh() {
    const refreshToken = this.getRefreshToken?.();
    if (!refreshToken) return false;
    let response;
    try {
      response = await fetch("/api/auth/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ refreshToken })
      });
    } catch (error) {
      throw new ApiError(error?.message || "Token refresh failed", { retryable: true });
    }
    if (!response.ok) return false;
    const payload = await response.json();
    this.onTokenRefresh?.(payload);
    return true;
  }

  login(password) {
    return this.request("/api/auth/login", { method: "POST", body: JSON.stringify({ password }) });
  }

  deviceLogin(deviceId, deviceToken, fingerprint = "") {
    return this.request("/api/auth/device-login", { method: "POST", body: JSON.stringify({ deviceId, deviceToken, fingerprint }) });
  }

  authStatus() {
    return this.request("/api/auth/status");
  }

  mobileBootstrap() {
    return this.request("/api/mobile/v1/bootstrap");
  }

  setupPassword(password) {
    return this.request("/api/auth/setup", { method: "POST", body: JSON.stringify({ password }) });
  }

  changePassword(currentPassword, newPassword) {
    return this.request("/api/auth/password", { method: "POST", body: JSON.stringify({ currentPassword, newPassword }) });
  }

  createPairingSession(permissionLevel = "phone") {
    return this.request("/api/pairing/session", { method: "POST", body: JSON.stringify({ permissionLevel }) });
  }

  completePairing(code, deviceName, fingerprint = "") {
    return this.request("/api/pairing/complete", { method: "POST", body: JSON.stringify({ code, deviceName, fingerprint }) });
  }

  devices() {
    return this.request("/api/devices");
  }

  renameDevice(deviceId, name) {
    return this.request("/api/devices", { method: "PATCH", body: JSON.stringify({ deviceId, name }) });
  }

  revokeDevice(deviceId) {
    return this.request("/api/devices", { method: "DELETE", body: JSON.stringify({ deviceId }) });
  }

  auditLog() {
    return this.request("/api/security/audit");
  }

  projects() {
    return this.request("/api/projects");
  }

  threads(projectCwd) {
    return this.request(`/api/threads${encodeQuery({ project: projectCwd })}`);
  }

  thread(threadId) {
    return this.request(`/api/threads/${encodeURIComponent(threadId)}`);
  }

  threadDetail(threadId, options = {}) {
    return this.request(
      `/api/threads/${encodeURIComponent(threadId)}/detail${encodeQuery({
        after: options.afterMessageId || "",
        before: options.beforeMessageId || "",
        limit: options.limit || ""
      })}`
    );
  }

  messages(threadId) {
    return this.request(`/api/threads/${encodeURIComponent(threadId)}/messages`);
  }

  send(threadId, message, attachments = [], runtime = {}) {
    return this.request(`/api/threads/${encodeURIComponent(threadId)}/send`, {
      method: "POST",
      body: JSON.stringify({ message, attachments, runtime, queueIfRunning: true })
    });
  }

  uploadFiles(files, options = {}) {
    return this.request("/api/uploads", {
      method: "POST",
      body: JSON.stringify({ files: withThreadScope(files, options.threadId || "") }),
      timeoutMs: 60000
    });
  }

  cancel(threadId) {
    return this.request(`/api/threads/${encodeURIComponent(threadId)}/cancel`, { method: "POST" });
  }

  retry(threadId) {
    return this.request(`/api/threads/${encodeURIComponent(threadId)}/retry`, { method: "POST" });
  }

  openDesktopThread(threadId) {
    return this.request(`/api/threads/${encodeURIComponent(threadId)}/open-desktop`, { method: "POST" });
  }

  createThread(options = {}) {
    return this.request("/api/threads/new", { method: "POST", body: JSON.stringify(options) });
  }

  openDesktopNewThread() {
    return this.request("/api/threads/new/open-desktop", { method: "POST" });
  }

  status(options = {}) {
    return this.request(`/api/system/status${encodeQuery({ deep: options.deep ? "1" : "" })}`);
  }

  model() {
    return this.request("/api/system/model");
  }

  setModel(model) {
    return this.request("/api/system/model", { method: "POST", body: JSON.stringify({ model }) });
  }

  threadModel(threadId) {
    return this.request(`/api/threads/${encodeURIComponent(threadId)}/model`);
  }

  setThreadModel(threadId, model) {
    return this.request(`/api/threads/${encodeURIComponent(threadId)}/model`, { method: "POST", body: JSON.stringify({ model }) });
  }

  runtimeDefaults() {
    return this.request("/api/runtime/defaults");
  }

  setRuntimeDefaults(controls) {
    return this.request("/api/runtime/defaults", { method: "POST", body: JSON.stringify({ controls }) });
  }

  threadRuntime(threadId) {
    return this.request(`/api/threads/${encodeURIComponent(threadId)}/runtime`);
  }

  setThreadRuntime(threadId, controls) {
    return this.request(`/api/threads/${encodeURIComponent(threadId)}/runtime`, { method: "POST", body: JSON.stringify({ controls }) });
  }

  followUps(threadId) {
    return this.request(`/api/threads/${encodeURIComponent(threadId)}/followups`);
  }

  enqueueFollowUp(threadId, message, runtime = {}) {
    return this.request(`/api/threads/${encodeURIComponent(threadId)}/followups`, { method: "POST", body: JSON.stringify({ message, runtime }) });
  }

  editFollowUp(threadId, followUpId, patch) {
    return this.request(`/api/threads/${encodeURIComponent(threadId)}/followups/${encodeURIComponent(followUpId)}`, {
      method: "PATCH",
      body: JSON.stringify(patch)
    });
  }

  reorderFollowUp(threadId, followUpId, direction) {
    return this.editFollowUp(threadId, followUpId, { direction });
  }

  cancelFollowUp(threadId, followUpId) {
    return this.request(`/api/threads/${encodeURIComponent(threadId)}/followups/${encodeURIComponent(followUpId)}`, { method: "DELETE" });
  }

  subagents(threadId) {
    return this.request(`/api/threads/${encodeURIComponent(threadId)}/subagents`);
  }

  createSubagent(threadId, payload) {
    return this.request(`/api/threads/${encodeURIComponent(threadId)}/subagents`, { method: "POST", body: JSON.stringify(payload) });
  }

  gitStatus(threadId) {
    return this.request(`/api/git/status${encodeQuery({ threadId })}`);
  }

  gitAction(payload) {
    return this.request("/api/git/action", { method: "POST", body: JSON.stringify(payload), timeoutMs: 120000 });
  }
}
