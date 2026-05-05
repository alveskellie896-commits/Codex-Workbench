const SEND_QUEUE_STORAGE_KEY = "codex-workbench-send-queue";
const MAX_STORED_ATTACHMENT_BYTES = 2.5 * 1024 * 1024;
const QUEUE_STALE_AFTER_MS = 12 * 60 * 60 * 1000;
const ACTIVE_RUN_PATTERNS = ["active run", "already has an active run"];
const DESKTOP_DELIVERY_PATTERNS = [
  "did not detect codex desktop receiving",
  "keep codex open",
  "desktop sync failed",
  "could not refresh codex desktop"
];
const NETWORK_PATTERNS = [
  "network",
  "fetch",
  "failed to fetch",
  "load failed",
  "timeout",
  "timed out",
  "connection",
  "offline",
  "disconnected"
];

export const ACTIVE_SEND_STAGES = new Set(["recovering", "queued", "preparing", "uploading", "sending", "retrying", "submitted", "delivered"]);
export const PROCESSABLE_SEND_STAGES = new Set(["queued", "preparing", "uploading", "sending", "retrying"]);
export const WAITING_REPLY_STAGES = new Set(["submitted", "delivered"]);
export const RECOVERABLE_REHYDRATE_STAGES = new Set(["queued", "preparing", "uploading", "sending", "retrying", "submitted", "delivered"]);
export const SEND_QUEUE_STALE_AFTER_MS = QUEUE_STALE_AFTER_MS;

function nowIso() {
  return new Date().toISOString();
}

function stringValue(value) {
  return String(value || "");
}

function attachmentPayloadBytes(attachments = []) {
  return attachments.reduce((total, attachment) => total + stringValue(attachment?.dataBase64).length, 0);
}

function fileSummary(files = []) {
  return files.map((file) => ({
    name: file.name || "attachment",
    type: file.type || "application/octet-stream",
    size: Number(file.size || 0)
  }));
}

function queueItemAgeMs(item) {
  const timestamp = Date.parse(item?.updatedAt || item?.createdAt || "");
  if (!Number.isFinite(timestamp)) return 0;
  return Date.now() - timestamp;
}

function staleRecoveryMessage(rawStage) {
  const stage = queueStageLabel(rawStage);
  return `这条手机发送记录停留在“${stage}”太久了，已停止自动重试。请确认电脑端聊天窗口正常后手动点“重试”。`;
}

function markProgressState(item, state, error = "") {
  const source = Array.isArray(item.fileProgress) && item.fileProgress.length ? item.fileProgress : item.fileMeta || [];
  return source.map((file) => ({
    name: file.name || "attachment",
    loaded: Number(file.loaded || 0),
    total: Number(file.total || file.size || 0),
    percent: Number(file.percent || 0),
    state,
    error
  }));
}

function sanitizeQueueItem(item) {
  if (!item?.id || !item.threadId) return null;
  const rawStage = item.stage || "queued";
  const recovering = RECOVERABLE_REHYDRATE_STAGES.has(rawStage);
  const createdAt = item.createdAt || nowIso();
  const updatedAt = item.updatedAt || createdAt;
  const base = {
    id: item.id,
    threadId: item.threadId,
    localMessageId: item.localMessageId || `local:${item.threadId}:${item.id}`,
    text: stringValue(item.text),
    displayText: stringValue(item.displayText || item.text),
    fileMeta: Array.isArray(item.fileMeta) ? item.fileMeta : [],
    fileProgress: Array.isArray(item.fileProgress) ? item.fileProgress : [],
    attachmentPayloads: Array.isArray(item.attachmentPayloads) ? item.attachmentPayloads : [],
    attachments: Array.isArray(item.attachments) ? item.attachments : [],
    stage: recovering ? "recovering" : rawStage,
    attempts: recovering ? 0 : Number(item.attempts || 0),
    error: recovering ? "" : stringValue(item.error),
    nextAttemptAt: recovering ? "" : item.nextAttemptAt || "",
    createdAt,
    updatedAt,
    attachmentPersisted: item.attachmentPersisted !== false,
    recoveredStage: recovering ? rawStage : stringValue(item.recoveredStage)
  };

  if (recovering && queueItemAgeMs(base) > QUEUE_STALE_AFTER_MS) {
    const error = staleRecoveryMessage(rawStage);
    return {
      ...base,
      stage: "failed",
      attempts: 0,
      error,
      nextAttemptAt: "",
      fileProgress: markProgressState(base, "failed", error)
    };
  }

  return base;
}

export function createSendQueueItem({ threadId, text, files = [] }) {
  const createdAt = nowIso();
  const id = `queue:${threadId}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
  const fileMeta = fileSummary(files);
  const attachmentLine = fileMeta.map((file) => `附件：${file.name}`).join("\n");
  const displayText = [stringValue(text), attachmentLine].filter(Boolean).join("\n");
  return {
    id,
    threadId,
    localMessageId: `local:${threadId}:${createdAt}`,
    text: stringValue(text),
    displayText,
    fileMeta,
    fileProgress: fileMeta.map((file) => ({
      name: file.name,
      loaded: 0,
      total: file.size,
      percent: 0,
      state: "queued"
    })),
    fileObjects: files,
    attachmentPayloads: [],
    attachments: [],
    stage: "queued",
    attempts: 0,
    error: "",
    nextAttemptAt: "",
    createdAt,
    updatedAt: createdAt,
    attachmentPersisted: true
  };
}

export function loadStoredSendQueue() {
  try {
    const raw = localStorage.getItem(SEND_QUEUE_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(sanitizeQueueItem).filter(Boolean);
  } catch {
    return [];
  }
}

export function storeSendQueue(items = []) {
  try {
    const serializable = items.map((item) => {
      const next = { ...item };
      delete next.fileObjects;
      if (attachmentPayloadBytes(next.attachmentPayloads) > MAX_STORED_ATTACHMENT_BYTES) {
        next.attachmentPayloads = [];
        next.attachmentPersisted = false;
      }
      return next;
    });
    localStorage.setItem(SEND_QUEUE_STORAGE_KEY, JSON.stringify(serializable));
  } catch {
    // The in-memory queue still protects against normal network jitter.
  }
}

export function clearStoredSendQueue() {
  try {
    localStorage.removeItem(SEND_QUEUE_STORAGE_KEY);
  } catch {
    // Best effort.
  }
}

export function isActiveQueueItem(item) {
  return ACTIVE_SEND_STAGES.has(item?.stage);
}

export function isQueueItemProcessable(item) {
  if (!PROCESSABLE_SEND_STAGES.has(item?.stage)) return false;
  if (!item.nextAttemptAt) return true;
  return new Date(item.nextAttemptAt).getTime() <= Date.now();
}

export function isQueueItemWaitingForReply(item) {
  return WAITING_REPLY_STAGES.has(item?.stage);
}

export function pendingReplyFromQueueItem(item) {
  if (!isActiveQueueItem(item)) return null;
  return {
    threadId: item.threadId,
    queueId: item.id,
    localMessageId: item.localMessageId || "",
    userText: item.displayText || item.text,
    stage: item.stage,
    attempts: item.attempts || 0,
    error: item.error || "",
    createdAt: item.createdAt || ""
  };
}

export function pendingRepliesFromQueue(items = []) {
  const next = {};
  for (const item of items) {
    const pendingReply = pendingReplyFromQueueItem(item);
    if (pendingReply && !next[pendingReply.threadId]) next[pendingReply.threadId] = pendingReply;
  }
  return next;
}

export function queueItemToLocalMessage(item) {
  return {
    id: item.localMessageId,
    threadId: item.threadId,
    role: "user",
    kind: "message",
    text: item.displayText || item.text,
    fileMeta: item.fileMeta || [],
    fileProgress: item.fileProgress || [],
    createdAt: item.createdAt || nowIso(),
    pending: isActiveQueueItem(item),
    failed: item.stage === "failed",
    pendingStage: item.stage,
    queueId: item.id,
    attempts: item.attempts || 0,
    error: item.error || ""
  };
}

export function queueStageLabel(stage) {
  const labels = {
    recovering: "正在确认上一条",
    queued: "待发送",
    preparing: "正在准备附件",
    uploading: "正在上传附件",
    sending: "正在发送",
    retrying: "正在自动重试",
    submitted: "已提交",
    delivered: "已送达",
    synced: "回复已同步",
    failed: "发送失败"
  };
  return labels[stage] || "正在发送";
}

export function queueStageHelp(stage, attempts = 0) {
  const labels = {
    recovering: "正在核对刷新前的发送状态；不会直接无限重试。",
    queued: "已在手机本地排队，网络恢复或前一条任务结束后会发送。",
    preparing: "正在读取附件；如果是 iCloud 或网盘文件，请等它下载到手机。",
    uploading: "正在把附件交给电脑端，只会显示在当前会话。",
    sending: "正在发送到电脑端。",
    retrying: `连接暂时不稳，正在第 ${Math.max(1, Number(attempts || 1))} 次自动重试。`,
    submitted: "电脑端已收到，正在等待回复。",
    delivered: "已送达电脑端，等待消息同步回来。",
    synced: "回复已经同步。",
    failed: "发送已停止，请按提示处理后手动重试。"
  };
  return labels[stage] || "正在发送。";
}

export function queueBackoffMs(attempts = 0) {
  const attempt = Math.max(1, Number(attempts || 1));
  return Math.min(30000, 1200 * 2 ** Math.min(attempt - 1, 5));
}

function queueErrorMessage(error) {
  const status = Number(error?.statusCode || 0);
  const message = stringValue(error?.message || error).toLowerCase();
  return { status, message };
}

export function queueRetryClass(error) {
  const { status, message } = queueErrorMessage(error);
  if (ACTIVE_RUN_PATTERNS.some((pattern) => message.includes(pattern)) || status === 409) return "active-run";
  if (DESKTOP_DELIVERY_PATTERNS.some((pattern) => message.includes(pattern))) return "desktop-delivery";
  if (error?.retryable || [408, 425, 429].includes(status) || status >= 500) return "transient";
  if (NETWORK_PATTERNS.some((pattern) => message.includes(pattern))) return "transient";
  return "none";
}

export function maxQueueAutoRetryAttempts(error) {
  switch (queueRetryClass(error)) {
    case "active-run":
      return 8;
    case "desktop-delivery":
      return 1;
    case "transient":
      return 4;
    default:
      return 0;
  }
}

export function isDesktopDeliveryQueueError(error) {
  return queueRetryClass(error) === "desktop-delivery";
}

export function isRetryableQueueError(error) {
  return maxQueueAutoRetryAttempts(error) > 0;
}
