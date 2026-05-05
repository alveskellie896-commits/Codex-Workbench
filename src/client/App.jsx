import { useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  Activity,
  AlertCircle,
  ArrowLeft,
  Bell,
  BellOff,
  BellRing,
  Bot,
  Camera,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  CheckCircle2,
  Cable,
  Clock3,
  Copy,
  FolderGit2,
  FolderPlus,
  Laptop,
  LockKeyhole,
  Loader2,
  LogOut,
  ListFilter,
  Maximize2,
  MessageSquare,
  Mic,
  Monitor,
  Moon,
  Paperclip,
  PencilLine,
  Pin,
  Plus,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Smartphone,
  Square,
  Sun,
  Wifi,
  WifiOff,
  Wrench,
  X
} from "lucide-react";
import { ApiClient, browserFingerprint, clearTokens, clearTrustedDevice, loadStoredTokens, loadTrustedDevice, storeTokens, storeTrustedDevice } from "./api.js";
import { applyComposerSuggestion, filterComposerSuggestions, getComposerTrigger } from "./composerAssist.js";
import { humanizeErrorMessage } from "./errorMessages.js";
import { filePreviewLabel } from "./filePreview.js";
import { mergeFetchedMessagesWithLocalDrafts, mergeThreadMessagesById } from "./messageMerge.js";
import {
  clearStoredSendQueue,
  createSendQueueItem,
  isActiveQueueItem,
  isDesktopDeliveryQueueError,
  isQueueItemProcessable,
  isRetryableQueueError,
  loadStoredSendQueue,
  maxQueueAutoRetryAttempts,
  pendingReplyFromQueueItem,
  pendingRepliesFromQueue,
  queueBackoffMs,
  queueItemToLocalMessage,
  queueStageHelp,
  queueStageLabel,
  storeSendQueue
} from "./sendQueue.js";
import {
  RECENT_UPLOADS_STORAGE_KEY,
  estimateUploadBatchBytes,
  formatFileSize,
  MAX_UPLOAD_BATCH_BYTES,
  MAX_UPLOAD_FILE_BYTES
} from "./uploadHistory.js";
import { useWorkbenchSocket } from "./useWorkbenchSocket.js";

const EMPTY_STATE = {
  threadId: null,
  activeRunId: null,
  phase: "idle",
  canCancel: false,
  canRetry: false
};
const APP_BUILD_ID = typeof import.meta.url === "string" ? new URL(import.meta.url).pathname : "dev";
const INITIAL_THREAD_DETAIL_PAGE_SIZE = 160;
const OLDER_THREAD_DETAIL_PAGE_SIZE = 120;
const MAX_THREAD_DETAIL_CACHE_ENTRIES = 12;
const CLIENT_META_POLL_MS = 30000;

const THEME_MODES = ["auto", "light", "dark"];
const COMPOSER_DRAFTS_STORAGE_KEY = "codex-workbench-composer-drafts";
const THREAD_PREFERENCES_STORAGE_KEY = "codex-workbench-thread-preferences";
const NOTIFICATION_PREF_STORAGE_KEY = "codex-workbench-completion-reminders";
const REMINDER_ALERTS_STORAGE_KEY = "codex-workbench-reminder-alerts";
const MAX_REMINDER_ALERTS = 40;
const DEFAULT_THREAD_TITLE = "新聊天";
const VIRTUAL_MESSAGE_THRESHOLD = 80;
const VIRTUAL_MESSAGE_OVERSCAN = 12;
const VIRTUAL_MESSAGE_ESTIMATE = 138;
const VIRTUAL_MESSAGE_HEIGHT_DELTA = 3;
const VIRTUAL_ACTION_ESTIMATE = 76;

function loadStoredThemeMode() {
  try {
    const value = localStorage.getItem("codex-workbench-theme");
    return THEME_MODES.includes(value) ? value : "auto";
  } catch {
    return "auto";
  }
}

function storeThemeMode(value) {
  try {
    localStorage.setItem("codex-workbench-theme", value);
  } catch {
    // Theme selection is a convenience preference; ignore storage failures.
  }
}

function loadStoredComposerDrafts() {
  try {
    const raw = localStorage.getItem(COMPOSER_DRAFTS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(([threadId, value]) => threadId && typeof value === "string" && value.trim())
    );
  } catch {
    return {};
  }
}

function storeComposerDrafts(value) {
  try {
    if (!value || typeof value !== "object") {
      localStorage.removeItem(COMPOSER_DRAFTS_STORAGE_KEY);
      return;
    }
    const entries = Object.entries(value).filter(([threadId, text]) => threadId && typeof text === "string" && text.trim());
    if (!entries.length) {
      localStorage.removeItem(COMPOSER_DRAFTS_STORAGE_KEY);
      return;
    }
    localStorage.setItem(COMPOSER_DRAFTS_STORAGE_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    // Draft storage is best-effort only.
  }
}

function normalizeThreadPreferences(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const pinned = source.pinned && typeof source.pinned === "object" && !Array.isArray(source.pinned) ? source.pinned : {};
  const favorites = source.favorites && typeof source.favorites === "object" && !Array.isArray(source.favorites) ? source.favorites : {};
  const aliasSource = source.aliases && typeof source.aliases === "object" && !Array.isArray(source.aliases) ? source.aliases : {};
  const aliases = {};
  for (const [threadId, alias] of Object.entries(aliasSource)) {
    const cleaned = cleanThreadTitle(alias);
    if (threadId && cleaned && ![DEFAULT_THREAD_TITLE, "新对话"].includes(cleaned)) aliases[threadId] = cleaned;
  }
  return {
    pinned: { ...favorites, ...pinned },
    aliases
  };
}

function loadStoredThreadPreferences() {
  try {
    const raw = localStorage.getItem(THREAD_PREFERENCES_STORAGE_KEY);
    return normalizeThreadPreferences(raw ? JSON.parse(raw) : {});
  } catch {
    return normalizeThreadPreferences({});
  }
}

function storeThreadPreferences(value) {
  try {
    localStorage.setItem(THREAD_PREFERENCES_STORAGE_KEY, JSON.stringify(normalizeThreadPreferences(value)));
  } catch {
    // Preferences are local convenience data; keep the UI working if storage fails.
  }
}

function supportsCompletionNotifications() {
  return typeof window !== "undefined" && "Notification" in window;
}

function getNotificationPermission() {
  if (!supportsCompletionNotifications()) return "unsupported";
  return Notification.permission || "default";
}

function loadStoredNotificationEnabled() {
  try {
    return localStorage.getItem(NOTIFICATION_PREF_STORAGE_KEY) === "enabled";
  } catch {
    return false;
  }
}

function storeNotificationEnabled(enabled) {
  try {
    if (enabled) localStorage.setItem(NOTIFICATION_PREF_STORAGE_KEY, "enabled");
    else localStorage.removeItem(NOTIFICATION_PREF_STORAGE_KEY);
  } catch {
    // Notification preference is best-effort only.
  }
}

function normalizeReminderAlert(alert) {
  if (!alert || typeof alert !== "object") return null;
  return {
    id: String(alert.id || `${Date.now()}:${Math.random().toString(36).slice(2, 7)}`),
    title: stringifyVisibleValue(alert.title || "Reminder"),
    body: stringifyVisibleValue(alert.body || ""),
    tone: ["success", "danger", "muted", "warning"].includes(alert.tone) ? alert.tone : "success",
    threadId: stringifyVisibleValue(alert.threadId || ""),
    createdAt: alert.createdAt || new Date().toISOString()
  };
}

function loadStoredReminderAlerts() {
  try {
    const raw = localStorage.getItem(REMINDER_ALERTS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeReminderAlert).filter(Boolean).slice(0, MAX_REMINDER_ALERTS);
  } catch {
    return [];
  }
}

function storeReminderAlerts(alerts = []) {
  try {
    const normalized = alerts.map(normalizeReminderAlert).filter(Boolean).slice(0, MAX_REMINDER_ALERTS);
    if (!normalized.length) {
      localStorage.removeItem(REMINDER_ALERTS_STORAGE_KEY);
      return;
    }
    localStorage.setItem(REMINDER_ALERTS_STORAGE_KEY, JSON.stringify(normalized));
  } catch {
    // Reminder history is convenience UI; do not block the app.
  }
}

function useVisualViewportHeight() {
  const stableLayoutHeightRef = useRef(0);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    let frame = 0;
    const timers = new Set();
    const isIOSLike = /iPad|iPhone|iPod/.test(window.navigator.userAgent) || (window.navigator.platform === "MacIntel" && window.navigator.maxTouchPoints > 1);
    const isEditableFocused = () => {
      const active = document.activeElement;
      if (!active || active === document.body) return false;
      if (active.isContentEditable) return true;
      return Boolean(active.matches?.("input, textarea, select, [contenteditable='true']"));
    };
    const updateViewportHeight = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const root = document.documentElement;
        const visualViewport = window.visualViewport;
        const rawLayoutHeight = window.innerHeight || root.clientHeight || visualViewport?.height || 0;
        const viewportHeight = visualViewport?.height || rawLayoutHeight;
        const viewportWidth = visualViewport?.width || window.innerWidth;
        const viewportTop = visualViewport?.offsetTop || 0;
        const viewportLeft = visualViewport?.offsetLeft || 0;
        const focusedEditable = isEditableFocused();
        const viewportLoss = Math.max(0, rawLayoutHeight - viewportHeight - viewportTop);
        const mobileLayout = viewportWidth <= 820 || window.matchMedia?.("(max-width: 820px)")?.matches;
        const keyboardOpen = focusedEditable && (mobileLayout || viewportLoss > 80 || viewportHeight < rawLayoutHeight * 0.78);

        if (!keyboardOpen) {
          stableLayoutHeightRef.current = Math.max(rawLayoutHeight, viewportHeight, root.clientHeight || 0);
        } else if (!stableLayoutHeightRef.current) {
          stableLayoutHeightRef.current = Math.max(rawLayoutHeight, viewportHeight, root.clientHeight || 0);
        }

        const layoutHeight = Math.max(rawLayoutHeight, stableLayoutHeightRef.current || 0, viewportHeight);
        const appTop = keyboardOpen ? viewportTop : 0;
        const visibleHeight = keyboardOpen ? viewportHeight : viewportTop + viewportHeight;
        const usableHeight = mobileLayout ? visibleHeight : layoutHeight;
        const keyboardInset = keyboardOpen && !isIOSLike ? Math.max(0, layoutHeight - appTop - usableHeight) : 0;
        root.style.setProperty("--layout-height", `${Math.round(layoutHeight)}px`);
        root.style.setProperty("--visual-height", `${Math.round(viewportHeight)}px`);
        root.style.setProperty("--visual-top", `${Math.round(viewportTop)}px`);
        root.style.setProperty("--keyboard-inset", `${Math.round(keyboardInset)}px`);
        root.style.setProperty("--app-height", `${Math.round(usableHeight)}px`);
        root.style.setProperty("--app-width", `${Math.round(viewportWidth)}px`);
        root.style.setProperty("--app-top", `${Math.round(appTop)}px`);
        root.style.setProperty("--app-left", `${Math.round(viewportLeft)}px`);
        root.dataset.keyboard = keyboardOpen ? "open" : "closed";

        if (keyboardOpen && (window.scrollX || window.scrollY)) {
          window.scrollTo(0, 0);
        }
      });
    };
    const updateViewportHeightSoon = (delays) => {
      const nextDelays = Array.isArray(delays) ? delays : [80, 240, 480];
      updateViewportHeight();
      for (const delay of nextDelays) {
        const timer = window.setTimeout(() => {
          timers.delete(timer);
          updateViewportHeight();
        }, delay);
        timers.add(timer);
      }
    };

    updateViewportHeight();
    const handleFocusIn = () => updateViewportHeightSoon([0, 50, 150, 320, 650]);
    const handleFocusOut = () => updateViewportHeightSoon([80, 220, 520]);
    window.addEventListener("resize", updateViewportHeightSoon);
    window.addEventListener("orientationchange", updateViewportHeightSoon);
    window.addEventListener("focusin", handleFocusIn);
    window.addEventListener("focusout", handleFocusOut);
    window.visualViewport?.addEventListener("resize", updateViewportHeightSoon);
    window.visualViewport?.addEventListener("scroll", updateViewportHeightSoon);

    return () => {
      cancelAnimationFrame(frame);
      for (const timer of timers) window.clearTimeout(timer);
      window.removeEventListener("resize", updateViewportHeightSoon);
      window.removeEventListener("orientationchange", updateViewportHeightSoon);
      window.removeEventListener("focusin", handleFocusIn);
      window.removeEventListener("focusout", handleFocusOut);
      window.visualViewport?.removeEventListener("resize", updateViewportHeightSoon);
      window.visualViewport?.removeEventListener("scroll", updateViewportHeightSoon);
    };
  }, []);
}

function usePreventHorizontalPagePan() {
  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    let startX = 0;
    let startY = 0;
    const onTouchStart = (event) => {
      const touch = event.touches?.[0];
      if (!touch) return;
      startX = touch.clientX;
      startY = touch.clientY;
    };
    const onTouchMove = (event) => {
      const touch = event.touches?.[0];
      if (!touch) return;
      const deltaX = touch.clientX - startX;
      const deltaY = touch.clientY - startY;
      if (Math.abs(deltaX) > Math.abs(deltaY) + 6) {
        event.preventDefault();
      }
    };

    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: false });

    return () => {
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
    };
  }, []);
}

function formatRelative(value) {
  if (!value) return "从未";
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return "未知";
  const delta = Date.now() - time;
  const minute = 60 * 1000;
  if (delta < minute) return "刚刚";
  if (delta < 60 * minute) return `${Math.floor(delta / minute)} 分钟前`;
  if (delta < 24 * 60 * minute) return `${Math.floor(delta / (60 * minute))} 小时前`;
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(time);
}

function formatDesktopRelative(value) {
  if (!value) return "";
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return "";
  const delta = Math.max(0, Date.now() - time);
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (delta < minute) return "刚刚";
  if (delta < hour) return `${Math.floor(delta / minute)} 分钟前`;
  if (delta < day) return `${Math.floor(delta / hour)} 小时前`;
  if (delta < 7 * day) return Math.floor(delta / day) + " 天前";
  return Math.floor(delta / (7 * day)) + " 周前";
}

function formatDiagnosticTime(value) {
  if (!value) return "未知";
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return "未知";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(time);
}

function diagnosticStatusLabel(status) {
  if (status === "ok") return "正常";
  if (status === "error") return "错误";
  return "警告";
}

function diagnosticSummaryLabel(status) {
  if (status === "ok") return "一切正常";
  if (status === "error") return "需要检查";
  return "发现风险";
}

function diagnosticDetailText(check) {
  if (!check?.detail) return "";
  if (check.status === "error") return humanizeErrorMessage(check.detail);
  return stringifyVisibleValue(check.detail);
}

function nearBottomThreshold(container) {
  if (!container) return 72;
  return Math.max(220, Math.min(640, container.clientHeight * 0.48));
}

function isContainerNearBottom(container) {
  if (!container) return true;
  const distanceToBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
  return distanceToBottom < nearBottomThreshold(container);
}

function inferPhoneLinkType(phoneUrl = "") {
  const value = stringifyVisibleValue(phoneUrl).toLowerCase();
  if (!value) return "未就绪";
  if (value.includes(".ts.net")) return "固定公网通道";
  if (value.includes("trycloudflare.com")) return "临时公网通道";
  if (value.includes("localhost.run")) return "临时公网通道";
  if (value.includes("127.0.0.1") || value.includes("localhost")) return "仅电脑本机";
  return "局域网或自定义通道";
}

function selfRecoveryState({ connectionInfo, sendQueue }) {
  const recoveringItem = sendQueue.find((item) => item.stage === "recovering");
  if (recoveringItem) {
    return {
      label: "正在确认上一条",
      detail: "检查手机消息是否已经送到电脑",
      tone: "ok"
    };
  }
  const retryingItem = sendQueue.find((item) => item.stage === "retrying");
  if (retryingItem) {
    return {
      label: "正在重试发送",
      detail: `第 ${retryingItem.attempts || 1} 次，超过上限会自动停下`,
      tone: "warning"
    };
  }
  const queuedCount = sendQueue.filter((item) => ["queued", "preparing", "uploading", "sending"].includes(item.stage)).length;
  if (queuedCount) {
    return {
      label: "已放入待发送",
      detail: `${queuedCount} 条消息会按顺序送到电脑`,
      tone: "ok"
    };
  }
  if (connectionInfo?.reconnecting || connectionInfo?.state === "offline") {
    return {
      label: "正在重新连接",
      detail: connectionInfo?.attempts ? `第 ${connectionInfo.attempts} 次尝试连接电脑` : "手机正在恢复实时同步",
      tone: "warning"
    };
  }
  return null;
}

function projectPathLabel(cwd = "") {
  const normalized = stringifyVisibleValue(cwd || "")
    .replace(/^\\\\\?\\/, "")
    .replace(/\\/g, "/")
    .replace(/\/+$/g, "");
  const parts = normalized.split("/").filter(Boolean);
  return parts.length ? parts.at(-1) : normalized || "未知项目";
}

const THREAD_TITLE_METADATA_MARKERS = [
  "工作目录",
  "目标文件",
  "总体目标",
  "背景与角色",
  "信息来源要求",
  "执行轮次规则",
  "范围限制",
  "禁止事项",
  "验收标准",
  "最终回复要求",
  "附件文件"
];

function stripThreadMetadataTail(value = "") {
  let text = stringifyVisibleValue(value || "").replace(/[\u200b-\u200d\ufeff]/g, "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  const lowerText = text.toLowerCase();
  let cutAt = -1;
  for (const marker of THREAD_TITLE_METADATA_MARKERS) {
    const index = lowerText.indexOf(marker.toLowerCase());
    if (index > 4 && (cutAt === -1 || index < cutAt)) cutAt = index;
  }
  if (cutAt > 4) text = text.slice(0, cutAt).trim();
  return text;
}

export function cleanThreadTitle(value = "") {
  let text = stripThreadMetadataTail(value);
  if (!text) return DEFAULT_THREAD_TITLE;

  const taskName = text.match(/任务名称[:：]\s*([^#\n。；;]{2,80})/);
  if (taskName?.[1]) return taskName[1].trim();
  const markdownTaskName = text.match(/#+\s*任务名称\s+(.+?)(?:\s+#+\s*(?:工作目录|目标文件|总体目标)|[。；;]|$)/);
  if (markdownTaskName?.[1]) return markdownTaskName[1].trim();
  if (/^AutoResearch[\s\u00a0　]*长任务[\s\u00a0　]*(请直接执行下面|请直接执行|实际任务内容|---|#)/i.test(text)) return "AutoResearch 长任务";

  const codexRequest = text.match(/My request for Codex:\s*(.+?)(?:# Files mentioned|# In app browser|附件文件[:：]|$)/i);
  if (codexRequest?.[1]) text = codexRequest[1].trim();

  const tailPattern = /(工\s*作\s*目\s*录|目\s*标\s*文\s*件|总\s*体\s*目\s*标|背\s*景\s*与\s*角\s*色|信\s*息\s*来\s*源\s*要\s*求)/;
  const tailMatch = text.match(tailPattern);
  if (tailMatch && tailMatch.index > 4) text = text.slice(0, tailMatch.index).trim();

  text = text
    .replace(/^#+\s*/g, "")
    .replace(/^Files mentioned by the user[:：]?/i, "文件对话")
    .replace(/^Context from my IDE setup[:：]?/i, "IDE 对话")
    .replace(/^以下是来自 prompt 文件 `?[^`]+`? 的任务指令[。:：-]?\s*/i, "AutoResearch 长任务 ")
    .replace(/AutoResearch 后台任务已经创建成功[；;，, ]*/i, "")
    .replace(/不要再启动 AutoResearch、?codex-autoresearch 或创建子任务[，,；; ]*/i, "")
    .replace(/\s+(工作目录|目标文件|总体目标|背景与角色|信息来源要求)[:：].*$/i, "")
    .replace(/[A-Z]:\\[^\s`，。；;]+/g, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  const finalTailMatch = text.match(tailPattern);
  if (finalTailMatch && finalTailMatch.index > 4) text = text.slice(0, finalTailMatch.index).trim();
  text = stripThreadMetadataTail(text);
  if (/^AutoResearch[\s\u00a0　]*长任务[\s\u00a0　]*(请直接执行下面|请直接执行|实际任务内容|---|#)/i.test(text)) return "AutoResearch 长任务";

  if (!text || /^[-#:：\s]+$/.test(text)) return DEFAULT_THREAD_TITLE;
  return text;
}

function threadDisplayTitle(thread, preferences) {
  return cleanThreadTitle(preferences?.aliases?.[thread?.id] || thread?.title || "");
}

function threadPreferenceTime(collection, threadId) {
  const value = collection?.[threadId];
  const time = new Date(value || 0).getTime();
  return Number.isFinite(time) ? time : 0;
}

function flattenThreadBranches(threads = []) {
  const flattened = [];
  for (const thread of threads || []) {
    flattened.push(thread);
    flattened.push(...flattenThreadBranches(thread.subagents || []));
  }
  return flattened;
}

function flattenProjectThreads(projects = []) {
  return (projects || []).flatMap((project) => flattenThreadBranches(project.recentThreads || []));
}

function sortThreadBranches(threads = [], preferences = normalizeThreadPreferences({})) {
  return [...threads]
    .map((thread) => ({
      ...thread,
      title: preferences.aliases?.[thread.id] || thread.title,
      subagents: sortThreadBranches(thread.subagents || [], preferences)
    }))
    .sort((a, b) => {
      const pinnedDelta = threadPreferenceTime(preferences.pinned, b.id) - threadPreferenceTime(preferences.pinned, a.id);
      if (pinnedDelta) return pinnedDelta;
      return new Date(b.updatedAt) - new Date(a.updatedAt);
    });
}

function applyThreadPreferencesToProjects(projects = [], preferences = normalizeThreadPreferences({})) {
  return (projects || []).map((project) => ({
    ...project,
    recentThreads: sortThreadBranches(project.recentThreads || [], preferences)
  }));
}

function preferredThreads(threads = [], preferences = normalizeThreadPreferences({}), key = "pinned") {
  const collection = preferences[key] || {};
  return dedupeThreadsById(threads)
    .filter((thread) => collection[thread.id])
    .sort((a, b) => threadPreferenceTime(collection, b.id) - threadPreferenceTime(collection, a.id));
}

function dedupeThreadsById(threads = []) {
  const seen = new Set();
  const result = [];
  for (const thread of threads || []) {
    const key = thread?.id || `thread:${result.length}:${thread?.updatedAt || ""}:${thread?.title || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(thread);
  }
  return result;
}

function sortFlatThreads(threads = [], preferences = normalizeThreadPreferences({})) {
  return dedupeThreadsById([...threads].sort((a, b) => {
    const pinnedDelta = threadPreferenceTime(preferences.pinned, b.id) - threadPreferenceTime(preferences.pinned, a.id);
    if (pinnedDelta) return pinnedDelta;
    return new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0);
  }));
}

function threadUpdatedTime(thread) {
  const time = new Date(thread?.updatedAt || 0).getTime();
  return Number.isFinite(time) ? time : 0;
}

function threadDateBucket(thread) {
  const time = threadUpdatedTime(thread);
  if (!time) return "更早";
  const now = new Date();
  const updated = new Date(time);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 24 * 60 * 60 * 1000;
  const startOfWeek = startOfToday - 6 * 24 * 60 * 60 * 1000;
  if (time >= startOfToday) return "今天";
  if (time >= startOfYesterday) return "昨天";
  if (time >= startOfWeek) return "最近 7 天";
  if (updated.getFullYear() === now.getFullYear()) {
    return new Intl.DateTimeFormat("zh-CN", { month: "long" }).format(updated);
  }
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long" }).format(updated);
}

function groupThreadsByDate(threads = []) {
  const groups = [];
  const byLabel = new Map();
  for (const thread of threads) {
    const label = threadDateBucket(thread);
    if (!byLabel.has(label)) {
      const group = { label, threads: [] };
      byLabel.set(label, group);
      groups.push(group);
    }
    byLabel.get(label).threads.push(thread);
  }
  return groups;
}

function agentText(thread) {
  return [thread?.title, thread?.agentNickname, thread?.agentRole].map(stringifyVisibleValue).join(" ").toLowerCase();
}

function filterSubagents(subagents = [], query = "") {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return subagents;
  return subagents.filter((thread) => agentText(thread).includes(normalizedQuery));
}

function buildMentionSuggestions({ detail, modelInfo }) {
  const thread = detail?.thread || {};
  const cwd = thread.cwd || "";
  const title = stringifyVisibleValue(cleanThreadTitle(thread.title || "当前对话"));
  const model = stringifyVisibleValue(thread.effectiveModel || thread.model || modelInfo.model || "");
  return [
    { id: "thread", label: "当前对话", description: title, keywords: ["thread", "conversation", "对话", title], insertText: "@thread " + title },
    { id: "project", label: "当前项目", description: projectPathLabel(cwd), keywords: ["project", "项目", cwd], insertText: "@project " + (cwd || projectPathLabel(cwd)) },
    { id: "model", label: "模型", description: model || "未选择模型", keywords: ["model", "模型", model], insertText: "@model " + (model || "未选择模型") },
    { id: "upload", label: "附件", description: "上传图片、PDF、Word 和其他文件", keywords: ["attach", "file", "image", "docx", "word", "upload", "附件"], insertText: "@attachment " }
  ];
}

function buildSlashSuggestions({ busy, onCancel, onSend, openFilePicker }) {
  return [
    { id: "status", label: "/进展", description: "总结现在做到哪了", keywords: ["status", "sync", "run", "状态", "进展"], insertText: "请总结当前进展、已经完成的部分和下一步。" },
    { id: "/retry", label: "/重试", description: "重新尝试上一轮", keywords: ["retry", "重试"], insertText: "请重试上一轮任务，并说明这次会怎样调整。" },
    { id: "cancel", label: "/停止", description: busy ? "停止当前回复" : "现在没有正在回复的内容", keywords: ["stop", "cancel", "停止"], disabled: !busy, action: onCancel },
    { id: "attach", label: "/文件", description: "上传文件或图片", keywords: ["attach", "upload", "file", "image", "上传", "文件"], action: openFilePicker },
    { id: "model", label: "/设置", description: "查看当前回复设置", keywords: ["model", "模型", "设置"], insertText: "请告诉我当前回复设置，以及哪些设置可以切换。" }
  ].map((item) => ({ ...item, action: item.action || (() => { if (item.insertText) onSend(item.insertText, []); }) }));
}

function eventType(event) {
  return event?.type || event?.event || event?.name;
}

function isBlockingRunState(runState) {
  const phase = stringifyVisibleValue(runState?.phase || "idle");
  return Boolean(runState?.activeRunId) && ["starting", "resuming", "running", "cancelling"].includes(phase);
}

function liveStatusLabel({ sending, awaitingReply, runState }) {
  if (awaitingReply?.stage === "recovering") return "正在确认上一条";
  const phase = stringifyVisibleValue(runState?.phase || "idle");
  if (awaitingReply?.stage) return queueStageLabel(awaitingReply.stage);
  if (phase === "starting") return "正在启动";
  if (phase === "sending-to-desktop" || sending) return "正在发送";
  if (phase === "resuming") return "正在继续";
  if (phase === "running") return "正在回复";
  if (phase === "cancelling") return "正在停止";
  if (awaitingReply) return "正在回复";
  return "";
}

function isTerminalRunState(runState) {
  const phase = stringifyVisibleValue(runState?.phase || "idle");
  return runState?.rolloutStatus === "complete" || ["cancelled", "failed"].includes(phase);
}

function normalizeMessageText(value) {
  return stringifyVisibleValue(value || "").trim();
}

function messageCreatedAtMs(message) {
  const time = new Date(message?.createdAt || 0).getTime();
  return Number.isFinite(time) ? time : 0;
}

function messageMatchesPendingReply(message, pendingReply) {
  if (!pendingReply?.threadId || message?.threadId !== pendingReply.threadId || message?.role !== "user") return false;
  if (pendingReply.localMessageId && message.id === pendingReply.localMessageId) return true;

  const targetText = normalizeMessageText(pendingReply.userText);
  const messageText = normalizeMessageText(message.text);
  if (targetText && messageText && (messageText === targetText || messageText.includes(targetText) || targetText.includes(messageText))) {
    return true;
  }

  const pendingTime = messageCreatedAtMs(pendingReply);
  const messageTime = messageCreatedAtMs(message);
  if (!pendingTime || !messageTime) return false;
  return Math.abs(messageTime - pendingTime) <= 2 * 60 * 1000;
}

function hasAssistantReplyAfterPendingUser(messages, pendingReply) {
  if (!pendingReply?.threadId || !Array.isArray(messages)) return false;
  let sawPendingUser = false;
  const pendingTime = messageCreatedAtMs(pendingReply);
  for (const message of messages) {
    if (message?.threadId !== pendingReply.threadId) continue;
    if (!sawPendingUser && messageMatchesPendingReply(message, pendingReply)) {
      sawPendingUser = true;
      continue;
    }
    if (message?.role === "assistant" && message?.kind === "message" && normalizeMessageText(message.text)) {
      if (!sawPendingUser) {
        const assistantTime = messageCreatedAtMs(message);
        if (pendingTime && assistantTime && assistantTime + 2000 >= pendingTime) {
          return true;
        }
        continue;
      }
      return true;
    }
  }
  return false;
}

function hasPersistedUserMessage(messages, pendingReply) {
  if (!pendingReply?.threadId || !Array.isArray(messages)) return false;
  return messages.some(
    (message) =>
      messageMatchesPendingReply(message, pendingReply) &&
      !message.pending &&
      !message.failed
  );
}

function isRenderableTraceMessage(message) {
  const isTool = message?.kind?.startsWith("tool") || message?.role === "tool";
  const isRunState = message?.kind === "run_state";
  return Boolean(isTool && !isRunState && message?.activityLabel);
}

function buildMessageDisplayItems(messages) {
  const items = [];
  let latestTrace = null;
  let latestTraceAttached = false;

  for (const message of messages) {
    if (message?.role === "user" && message?.kind === "message") {
      latestTrace = null;
      latestTraceAttached = false;
      items.push({ type: "message", message, trace: null });
      continue;
    }
    if (isRenderableTraceMessage(message)) {
      latestTrace = message;
      latestTraceAttached = false;
      continue;
    }
    if (message?.kind === "run_state") continue;
    if (message?.role === "assistant" && message?.kind === "message") {
      items.push({
        type: "message",
        message,
        trace: latestTrace
      });
      latestTraceAttached = Boolean(latestTrace);
      continue;
    }
    items.push({ type: "message", message, trace: null });
  }

  if (latestTrace && !latestTraceAttached) {
    items.push({ type: "pending-trace", trace: latestTrace });
  }

  return items;
}

function isOperationalAssistantUpdate(message) {
  if (message?.role !== "assistant" || message?.kind !== "message") return false;
  const text = compactVisibleValue(message.text || "", 360).replace(/\s+/g, " ").trim();
  if (!text || text.length > 300) return false;
  if (/```|#{1,6}\s|^\s*[-*]\s|\b\d+\.\s/.test(text)) return false;

  const statusLead = /^(我(先|现在|已经|会|再|准备|刚|看|抓|把)|现在|接下来|核心改动|针对测试|完整测试|服务|页面|实测|本地和手机|好信号|已确认|已完成|Running|Now|Next|I('|’)m|I('|’)ve|I will|I'll)/i;
  const statusAction = /(确认|检查|核对|准备|修改|改|修|跑|测试|构建|重启|刷新|验证|部署|截图|服务|页面|代码|文件|build|test|restart|reload|verify|deploy|service|page|screenshot)/i;
  return statusLead.test(text) && statusAction.test(text);
}

function compactOperationalRows(rows = []) {
  return rows.filter((row) => !(row?.type === "message" && isOperationalAssistantUpdate(row.message)));
}

function isToolLikeMessage(message) {
  return Boolean(message?.kind?.startsWith("tool") || message?.role === "tool");
}

function isConversationMessage(message) {
  return Boolean(message && message.kind === "message" && (message.role === "user" || message.role === "assistant"));
}

function isActionMessage(message) {
  return Boolean(message && isRenderableTraceMessage(message));
}

function normalizeSearchQuery(value) {
  return stringifyVisibleValue(value || "").trim().toLowerCase();
}

function messageSearchText(message) {
  if (!message) return "";
  return [
    message.text,
    message.outputPreview,
    message.activityLabel,
    message.toolName,
    message.kind,
    message.role
  ]
    .map(stringifyVisibleValue)
    .filter(Boolean)
    .join("\n")
    .toLowerCase();
}

function displayItemSearchText(item) {
  if (!item) return "";
  if (item.type === "pending-trace") return messageSearchText(item.trace);
  return [messageSearchText(item.message), messageSearchText(item.trace)].filter(Boolean).join("\n");
}

function lowerBound(values, target) {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (values[middle] < target) low = middle + 1;
    else high = middle;
  }
  return low;
}

function messageRowKey(row, index) {
  if (row.key) return row.key;
  if (row.type === "pending-trace") return `trace:${row.trace?.id || index}`;
  return row.message?.id || `row:${index}`;
}

function messageRowsSignature(rows = []) {
  const last = rows.at(-1);
  if (!last) return "empty";
  const message = last.message || last.trace || {};
  const text = message.text || message.outputPreview || message.activityLabel || "";
  return `${rows.length}:${messageRowKey(last, rows.length - 1)}:${text.length}`;
}

function useVirtualRows(items, containerRef, listRef, { enabled = true, estimate = VIRTUAL_MESSAGE_ESTIMATE, overscan = VIRTUAL_MESSAGE_OVERSCAN } = {}) {
  const heightsRef = useRef(new Map());
  const rangeRef = useRef({ start: 0, end: items.length });
  const frameRef = useRef(0);
  const heightFrameRef = useRef(0);
  const [range, setRange] = useState(() => ({ start: 0, end: items.length }));
  const [heightVersion, setHeightVersion] = useState(0);
  const keys = useMemo(() => items.map(messageRowKey), [items]);
  const offsets = useMemo(() => {
    const nextOffsets = [0];
    for (const key of keys) {
      nextOffsets.push(nextOffsets[nextOffsets.length - 1] + (heightsRef.current.get(key) || estimate));
    }
    return nextOffsets;
  }, [estimate, heightVersion, keys]);
  const totalHeight = offsets[offsets.length - 1] || 0;

  const updateRange = useCallback(() => {
    if (!enabled) {
      const next = { start: 0, end: items.length };
      rangeRef.current = next;
      setRange(next);
      return;
    }
    const container = containerRef.current;
    if (!container) return;
    const listTop = listRef.current?.offsetTop || 0;
    const viewportTop = Math.max(0, container.scrollTop - listTop);
    const viewportBottom = viewportTop + container.clientHeight;
    const nextStart = Math.max(0, lowerBound(offsets, viewportTop) - 1 - overscan);
    const nextEnd = Math.min(items.length, lowerBound(offsets, viewportBottom) + overscan);
    const current = rangeRef.current;
    if (current.start === nextStart && current.end === nextEnd) return;
    const next = { start: nextStart, end: Math.max(nextStart, nextEnd) };
    rangeRef.current = next;
    setRange(next);
  }, [containerRef, enabled, items.length, listRef, offsets, overscan]);

  useLayoutEffect(() => {
    const next = enabled ? rangeRef.current : { start: 0, end: items.length };
    rangeRef.current = { start: Math.min(next.start, items.length), end: Math.min(Math.max(next.end, next.start), items.length) };
    updateRange();
  }, [enabled, items.length, updateRange]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    const schedule = () => {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = requestAnimationFrame(updateRange);
    };
    schedule();
    container.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(frameRef.current);
      container.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [containerRef, updateRange]);

  useEffect(
    () => () => {
      cancelAnimationFrame(heightFrameRef.current);
    },
    []
  );

  const scheduleHeightVersion = useCallback(() => {
    if (heightFrameRef.current) return;
    heightFrameRef.current = requestAnimationFrame(() => {
      heightFrameRef.current = 0;
      setHeightVersion((current) => current + 1);
    });
  }, []);

  const measure = useCallback(
    (key, node) => {
      if (!enabled || !node || !key) return;
      const nextHeight = Math.ceil(node.getBoundingClientRect().height);
      if (!nextHeight) return;
      const previous = heightsRef.current.get(key) || 0;
      if (previous && Math.abs(previous - nextHeight) <= VIRTUAL_MESSAGE_HEIGHT_DELTA) return;
      heightsRef.current.set(key, nextHeight);
      scheduleHeightVersion();
    },
    [enabled, scheduleHeightVersion]
  );

  const safeStart = enabled ? Math.min(range.start, items.length) : 0;
  const safeEnd = enabled ? Math.min(Math.max(range.end, safeStart), items.length) : items.length;
  return {
    enabled,
    rows: items.slice(safeStart, safeEnd).map((item, offset) => ({ item, index: safeStart + offset, key: keys[safeStart + offset] })),
    beforeHeight: enabled ? offsets[safeStart] || 0 : 0,
    afterHeight: enabled ? Math.max(0, totalHeight - (offsets[safeEnd] || 0)) : 0,
    measure,
    totalHeight
  };
}

function filterThreadBranchForQuery(thread, query = "") {
  const normalizedQuery = normalizeSearchQuery(query);
  if (!normalizedQuery) return thread;
  const filteredSubagents = (thread.subagents || [])
    .map((subagent) => filterThreadBranchForQuery(subagent, normalizedQuery))
    .filter(Boolean);
  const selfText = [thread?.title, thread?.agentNickname, thread?.agentRole, thread?.gitBranch, thread?.cwd, thread?.projectCwd]
    .map(stringifyVisibleValue)
    .join(" ")
    .toLowerCase();
  if (selfText.includes(normalizedQuery) || filteredSubagents.length) {
    return { ...thread, subagents: filteredSubagents };
  }
  return null;
}

function filterProjectsForQuery(projects, query = "") {
  const normalizedQuery = normalizeSearchQuery(query);
  if (!normalizedQuery) return projects;
  return (projects || [])
    .map((project) => {
      const filteredThreads = (project.recentThreads || [])
        .map((thread) => filterThreadBranchForQuery(thread, normalizedQuery))
        .filter(Boolean);
      const projectText = [project.label, project.cwd].map(stringifyVisibleValue).join(" ").toLowerCase();
      if (projectText.includes(normalizedQuery) || filteredThreads.length) {
        return { ...project, recentThreads: filteredThreads };
      }
      return null;
    })
    .filter(Boolean);
}

function countThreadResults(threads = []) {
  return (threads || []).reduce((total, thread) => total + 1 + countThreadResults(thread.subagents || []), 0);
}

function countProjectSearchResults(projects = []) {
  return (projects || []).reduce((total, project) => total + countThreadResults(project.recentThreads || []), 0);
}

function summarizeDraft(text = "") {
  const normalized = stringifyVisibleValue(text || "").replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  return normalized.length > 18 ? `${normalized.slice(0, 18)}...` : normalized;
}

function getCollapsiblePreview(text = "", maxLength = 420) {
  const value = stringifyVisibleValue(text || "");
  if (!value) return { collapsed: "", shouldCollapse: false };
  if (value.length <= maxLength) return { collapsed: value, shouldCollapse: false };
  return {
    collapsed: `${value.slice(0, maxLength).trimEnd()}...`,
    shouldCollapse: true
  };
}

async function copyText(value) {
  const normalized = stringifyVisibleValue(value || "");
  if (!normalized) return false;
  if (navigator?.clipboard?.writeText) {
    await navigator.clipboard.writeText(normalized);
    return true;
  }
  const textarea = document.createElement("textarea");
  textarea.value = normalized;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  const success = document.execCommand("copy");
  document.body.removeChild(textarea);
  return success;
}

function threadStatusFromRunState(runState) {
  const phase = stringifyVisibleValue(runState?.phase || "idle");
  if (isBlockingRunState(runState)) return "running";
  if (runState?.rolloutStatus === "complete") return "complete";
  if (phase === "failed") return "failed";
  if (phase === "cancelled") return "cancelled";
  if (phase === "idle" && runState?.updatedAt && runState?.transport !== "desktop") return "complete";
  return "idle";
}

function threadListStatus({ thread, pendingReply, isRunning }) {
  const stage = stringifyVisibleValue(pendingReply?.stage || "");
  if (["recovering", "queued", "preparing", "uploading", "sending", "retrying"].includes(stage)) {
    return { key: "queued", label: queueStageLabel(stage), busy: true };
  }
  if (["submitted", "delivered"].includes(stage)) {
    return { key: "processing", label: stage === "delivered" ? "正在回复" : "已送达", busy: true };
  }
  if (isRunning || thread?.status === "running") return { key: "running", label: "正在回复", busy: true };
  if (thread?.status === "failed") return { key: "failed", label: "失败", busy: false };
  if (thread?.status === "cancelled") return { key: "cancelled", label: "已停止", busy: false };
  if (thread?.status === "complete" || thread?.status === "synced") return { key: "complete", label: "完成", busy: false };
  return { key: "idle", label: "", busy: false };
}

function runPhaseLabel(phase = "") {
  const value = stringifyVisibleValue(phase || "").toLowerCase();
  const labels = {
    idle: "已就绪",
    ready: "已就绪",
    starting: "正在启动",
    "sending-to-desktop": "正在发送",
    resuming: "正在继续",
    running: "正在回复",
    cancelling: "正在停止",
    cancelled: "已停止",
    failed: "失败",
    complete: "完成"
  };
  return labels[value] || stringifyVisibleValue(phase || "已就绪");
}

function toolStatusLabel(status = "finished") {
  const value = stringifyVisibleValue(status || "finished").toLowerCase();
  if (["finished", "complete", "completed", "success", "ok"].includes(value)) return "完成";
  if (["failed", "error"].includes(value)) return "失败";
  if (["running", "pending", "processing"].includes(value)) return "进行中";
  return stringifyVisibleValue(status || "完成");
}

function patchThreadStatusInTree(threads, threadId, status) {
  let changed = false;
  const nextThreads = (threads || []).map((thread) => {
    const currentSubagents = Array.isArray(thread.subagents) ? thread.subagents : [];
    const nextSubagents = patchThreadStatusInTree(currentSubagents, threadId, status);

    if (thread.id === threadId) {
      if (thread.status === status && nextSubagents === currentSubagents) return thread;
      changed = true;
      return { ...thread, status, subagents: nextSubagents };
    }

    if (nextSubagents !== currentSubagents) {
      changed = true;
      return { ...thread, subagents: nextSubagents };
    }

    return thread;
  });

  return changed ? nextThreads : threads;
}

function persistedThreadMessages(messages, threadId) {
  return (Array.isArray(messages) ? messages : []).filter(
    (message) => message?.threadId === threadId && !message?.id?.startsWith("local:")
  );
}

function buildThreadHistory(detail, serverMessages, fallbackHistory = null, mode = "latest") {
  const loadedMessages = Array.isArray(serverMessages) ? serverMessages : [];
  const oldestLoadedMessageId = loadedMessages.find((message) => message?.id)?.id || "";
  const newestLoadedMessageId = [...loadedMessages].reverse().find((message) => message?.id)?.id || "";
  const loadedMessageCount = loadedMessages.length;
  const totalMessageCount = Number.isFinite(Number(detail?.totalMessageCount))
    ? Number(detail.totalMessageCount)
    : fallbackHistory?.totalMessageCount || loadedMessageCount;

  if (mode === "incremental") {
    return {
      hasOlder: Boolean(fallbackHistory?.hasOlder),
      loadedMessageCount,
      totalMessageCount,
      oldestLoadedMessageId: fallbackHistory?.oldestLoadedMessageId || oldestLoadedMessageId,
      newestLoadedMessageId,
      pageLimit: detail?.pageLimit || fallbackHistory?.pageLimit || INITIAL_THREAD_DETAIL_PAGE_SIZE
    };
  }

  if (mode === "older") {
    return {
      hasOlder: Boolean(detail?.hasOlder),
      loadedMessageCount,
      totalMessageCount,
      oldestLoadedMessageId,
      newestLoadedMessageId: fallbackHistory?.newestLoadedMessageId || newestLoadedMessageId,
      pageLimit: detail?.pageLimit || fallbackHistory?.pageLimit || OLDER_THREAD_DETAIL_PAGE_SIZE
    };
  }

  return {
    hasOlder: Boolean(detail?.hasOlder),
    loadedMessageCount,
    totalMessageCount,
    oldestLoadedMessageId,
    newestLoadedMessageId,
    pageLimit: detail?.pageLimit || INITIAL_THREAD_DETAIL_PAGE_SIZE
  };
}

function fileToUploadPayload(file, onProgress = () => {}) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    const total = Number(file.size || 0);
    onProgress({ name: file.name, loaded: 0, total, percent: 0, state: "reading" });
    reader.addEventListener("progress", (event) => {
      const progressTotal = event.lengthComputable ? event.total : total;
      const loaded = event.lengthComputable ? event.loaded : 0;
      const percent = progressTotal > 0 ? Math.min(99, Math.round((loaded / progressTotal) * 100)) : 0;
      onProgress({ name: file.name, loaded, total: progressTotal, percent, state: "reading" });
    });
    reader.addEventListener("error", () => {
      const error = new Error(`Failed to read ${file.name}`);
      onProgress({ name: file.name, loaded: 0, total, percent: 0, state: "failed", error: error.message });
      reject(error);
    });
    reader.addEventListener("load", () => {
      const dataUrl = String(reader.result || "");
      const dataBase64 = dataUrl.includes(",") ? dataUrl.split(",").pop() : "";
      onProgress({ name: file.name, loaded: total, total, percent: 100, state: "ready" });
      resolve({ name: file.name, type: file.type || "application/octet-stream", dataBase64 });
    });
    reader.readAsDataURL(file);
  });
}

export default function App() {
  useVisualViewportHeight();
  usePreventHorizontalPagePan();

  const [tokens, setTokens] = useState(() => loadStoredTokens());
  const [trustedDevice, setTrustedDevice] = useState(() => loadTrustedDevice());
  const [projects, setProjects] = useState([]);
  const [threads, setThreads] = useState([]);
  const [selectedProject, setSelectedProject] = useState(null);
  const [selectedThreadId, setSelectedThreadId] = useState(null);
  const [threadDetail, setThreadDetail] = useState(null);
  const [messages, setMessages] = useState([]);
  const [status, setStatus] = useState(null);
  const [modelInfo, setModelInfo] = useState({ model: "", availableModels: [] });
  const [screen, setScreen] = useState("projects");
  const [themeMode, setThemeMode] = useState(() => loadStoredThemeMode());
  const [authStatus, setAuthStatus] = useState(null);
  const [passwordPanelOpen, setPasswordPanelOpen] = useState(false);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [diagnostics, setDiagnostics] = useState(null);
  const [diagnosticsLoading, setDiagnosticsLoading] = useState(false);
  const [composerDrafts, setComposerDrafts] = useState(() => loadStoredComposerDrafts());
  const [reminderAlerts, setReminderAlerts] = useState(() => loadStoredReminderAlerts());
  const [reminderPanelOpen, setReminderPanelOpen] = useState(false);
  const [reminderUnread, setReminderUnread] = useState(0);
  const [notificationEnabled, setNotificationEnabled] = useState(() => loadStoredNotificationEnabled());
  const [notificationPermission, setNotificationPermission] = useState(() => getNotificationPermission());
  const [inAppNotice, setInAppNotice] = useState(null);
  const [sendQueue, setSendQueue] = useState(() => loadStoredSendQueue());
  const [isPending, startTransition] = useTransition();
  const [loading, setLoading] = useState({ projects: false, threads: false, detail: false, sending: false });
  const [pendingReplies, setPendingReplies] = useState({});
  const [error, setError] = useState("");
  const [loadingOlder, setLoadingOlder] = useState(false);
  const messagesEndRef = useRef(null);
  const messagesContainerRef = useRef(null);
  const pendingRepliesRef = useRef({});
  const sendQueueRef = useRef(sendQueue);
  const reminderAlertsRef = useRef(reminderAlerts);
  const reminderUnreadRef = useRef(reminderUnread);
  const notificationEnabledRef = useRef(notificationEnabled);
  const notificationRegistrationRef = useRef(null);
  const notifiedRunsRef = useRef(new Set());
  const noticeTimerRef = useRef(0);
  const sendQueueTimerRef = useRef(0);
  const queueRecoveryTimerRef = useRef(0);
  const queueProcessingRef = useRef(false);
  const queueRecoveryRef = useRef(false);
  const buildReloadingRef = useRef(false);
  const apiRef = useRef(null);
  const tokensRef = useRef(tokens);
  const localDraftsRef = useRef([]);
  const messagesRef = useRef([]);
  const threadDetailRef = useRef(null);
  const threadCacheRef = useRef(new Map());
  const olderHistoryAnchorRef = useRef(null);
  const lastAutoScrollThreadRef = useRef(null);
  const pendingScrollRestoreRef = useRef(null);
  const selectedThreadIdRef = useRef(null);
  const activeProjectCwdRef = useRef("");
  const detailLoadRef = useRef({ threadId: null, requestKey: "", promise: null });
  const detailReloadRequestedRef = useRef(null);
  const detailRequestSeqRef = useRef(0);
  const detailRefreshTimerRef = useRef(0);
  const projectsRefreshTimerRef = useRef(0);
  const threadsRefreshTimerRef = useRef(0);
  const statusRefreshTimerRef = useRef(0);
  const projectsLoadRef = useRef({ promise: null });
  const projectsRequestSeqRef = useRef(0);
  const threadsLoadRef = useRef({ projectCwd: "", promise: null });
  const threadsRequestSeqRef = useRef(0);
  const activeProjectCwd = selectedProject?.cwd || "";
  const deferredMessages = useDeferredValue(messages);
  const selectedAwaitingReply = selectedThreadId ? pendingReplies[selectedThreadId] || null : null;

  useEffect(() => {
    document.documentElement.dataset.theme = themeMode;
    storeThemeMode(themeMode);
  }, [themeMode]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    threadDetailRef.current = threadDetail;
  }, [threadDetail]);

  useEffect(() => {
    storeComposerDrafts(composerDrafts);
  }, [composerDrafts]);

  useEffect(() => {
    try {
      localStorage.removeItem(RECENT_UPLOADS_STORAGE_KEY);
    } catch {
      // Ignore storage cleanup failures.
    }
  }, []);

  useEffect(() => {
    reminderAlertsRef.current = reminderAlerts;
    storeReminderAlerts(reminderAlerts);
  }, [reminderAlerts]);

  useEffect(() => {
    reminderUnreadRef.current = reminderUnread;
    document.title = reminderUnread ? `(${reminderUnread}) 聊天` : "聊天";
  }, [reminderUnread]);

  useEffect(() => {
    notificationEnabledRef.current = notificationEnabled;
    storeNotificationEnabled(notificationEnabled);
  }, [notificationEnabled]);

  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return undefined;
    let cancelled = false;
    navigator.serviceWorker
      .register("/sw.js")
      .then((registration) => {
        if (!cancelled) notificationRegistrationRef.current = registration;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    let cancelled = false;
    let inflight = false;

    const clearPwaShellCaches = async () => {
      try {
        const registration = await navigator.serviceWorker?.getRegistration?.();
        registration?.active?.postMessage?.({ type: "CLEAR_OLD_CACHES" });
        registration?.waiting?.postMessage?.({ type: "SKIP_WAITING" });
      } catch {}
      try {
        if ("caches" in window) {
          const keys = await window.caches.keys();
          await Promise.all(keys.filter((key) => key.startsWith("codex-workbench-")).map((key) => window.caches.delete(key)));
        }
      } catch {}
    };

    const reloadFreshClient = async (remoteBuildId) => {
      const reloadKey = `codex-workbench-build-reload:${APP_BUILD_ID}:${remoteBuildId}`;
      const attempts = Number(window.sessionStorage.getItem(reloadKey) || "0");
      if (attempts >= 2) return;
      window.sessionStorage.setItem(reloadKey, String(attempts + 1));
      buildReloadingRef.current = true;
      await clearPwaShellCaches();
      const freshUrl = new URL(window.location.href);
      freshUrl.searchParams.set("fresh", Date.now().toString());
      window.location.replace(freshUrl.toString());
    };

    const checkClientBuild = async () => {
      if (cancelled || inflight || buildReloadingRef.current) return;
      inflight = true;
      try {
        const response = await fetch(`/api/client-meta?ts=${Date.now()}`, {
          headers: { Accept: "application/json" },
          cache: "no-store"
        });
        if (!response.ok) return;
        const payload = await response.json();
        const remoteBuildId = stringifyVisibleValue(payload?.buildId || "");
        if (remoteBuildId && remoteBuildId !== APP_BUILD_ID) {
          await reloadFreshClient(remoteBuildId);
        }
      } catch {
        // Best effort only. The current page should keep working even if build polling fails.
      } finally {
        inflight = false;
      }
    };

    const handleVisibility = () => {
      if (document.visibilityState === "visible") checkClientBuild();
    };
    const handleFocus = () => checkClientBuild();
    const handlePageShow = (event) => {
      if (event.persisted) checkClientBuild();
    };

    checkClientBuild();
    const timer = window.setInterval(checkClientBuild, CLIENT_META_POLL_MS);
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("focus", handleFocus);
    window.addEventListener("pageshow", handlePageShow);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("pageshow", handlePageShow);
    };
  }, []);

  useEffect(() => {
    sendQueueRef.current = sendQueue;
    storeSendQueue(sendQueue);
    const nextPendingReplies = pendingRepliesFromQueue(sendQueue);
    pendingRepliesRef.current = nextPendingReplies;
    setPendingReplies(nextPendingReplies);
  }, [sendQueue]);

  useEffect(() => {
    selectedThreadIdRef.current = selectedThreadId;
  }, [selectedThreadId]);

  useEffect(() => {
    activeProjectCwdRef.current = activeProjectCwd;
  }, [activeProjectCwd]);

  useEffect(() => {
    if (!selectedThreadId || !threadDetail) return;
    const nextCache = new Map(threadCacheRef.current);
    nextCache.delete(selectedThreadId);
    nextCache.set(selectedThreadId, {
      detail: threadDetail,
      messages,
      cachedAt: Date.now()
    });
    while (nextCache.size > MAX_THREAD_DETAIL_CACHE_ENTRIES) {
      const oldestKey = nextCache.keys().next().value;
      nextCache.delete(oldestKey);
    }
    threadCacheRef.current = nextCache;
  }, [messages, selectedThreadId, threadDetail]);

  useLayoutEffect(() => {
    const anchor = olderHistoryAnchorRef.current;
    const container = messagesContainerRef.current;
    if (!container) return;
    if (anchor && anchor.threadId === selectedThreadIdRef.current) {
      const delta = container.scrollHeight - anchor.scrollHeight;
      container.scrollTop = anchor.scrollTop + Math.max(delta, 0);
      olderHistoryAnchorRef.current = null;
      return;
    }
    const pendingRestore = pendingScrollRestoreRef.current;
    if (pendingRestore?.threadId === selectedThreadIdRef.current) {
      container.scrollTop = pendingRestore.scrollTop;
      pendingScrollRestoreRef.current = null;
    }
  }, [messages, selectedThreadId]);

  useEffect(
    () => () => {
      window.clearTimeout(detailRefreshTimerRef.current);
      window.clearTimeout(projectsRefreshTimerRef.current);
      window.clearTimeout(threadsRefreshTimerRef.current);
      window.clearTimeout(statusRefreshTimerRef.current);
      window.clearTimeout(sendQueueTimerRef.current);
      window.clearTimeout(queueRecoveryTimerRef.current);
      window.clearTimeout(noticeTimerRef.current);
    },
    []
  );

  function cycleThemeMode() {
    setThemeMode((current) => THEME_MODES[(THEME_MODES.indexOf(current) + 1) % THEME_MODES.length]);
  }

  function clearRefreshTimers() {
    window.clearTimeout(detailRefreshTimerRef.current);
    window.clearTimeout(projectsRefreshTimerRef.current);
    window.clearTimeout(threadsRefreshTimerRef.current);
    window.clearTimeout(statusRefreshTimerRef.current);
    window.clearTimeout(sendQueueTimerRef.current);
    window.clearTimeout(queueRecoveryTimerRef.current);
    window.clearTimeout(noticeTimerRef.current);
  }

  function showInAppNotice(notice) {
    setInAppNotice({ ...notice, id: `${Date.now()}:${Math.random().toString(36).slice(2, 7)}` });
    window.clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = window.setTimeout(() => setInAppNotice(null), notice.tone === "danger" ? 7000 : 4200);
  }

  function openReminderPanel() {
    setReminderPanelOpen(true);
    setReminderUnread(0);
  }

  function closeReminderPanel() {
    setReminderPanelOpen(false);
  }

  function toggleReminderCenter() {
    setNotificationEnabled((current) => {
      const enabled = !current;
      showInAppNotice({
        title: enabled ? "Reminder center on" : "Reminder center off",
        body: enabled ? "Task changes will appear in the bell and may vibrate your phone." : "Task changes will still be recorded, but vibration is off.",
        tone: enabled ? "success" : "muted"
      });
      return enabled;
    });
  }

  function clearReminderAlerts() {
    setReminderAlerts([]);
    setReminderUnread(0);
  }

  async function requestSystemNotificationPermission() {
    if (!supportsCompletionNotifications()) {
      setNotificationPermission("unsupported");
      showInAppNotice({ title: "使用站内提醒", body: "这个浏览器不支持系统通知。", tone: "muted" });
      return;
    }
    const currentPermission = getNotificationPermission();
    if (currentPermission === "denied") {
      setNotificationPermission("denied");
      showInAppNotice({ title: "系统通知不可用", body: "浏览器拦截了系统通知，站内提醒仍然可用。", tone: "muted" });
      return;
    }
    try {
      const permission = currentPermission === "granted" ? "granted" : await Notification.requestPermission();
      setNotificationPermission(permission);
      if (permission === "granted") {
        setNotificationEnabled(true);
        showInAppNotice({ title: "系统通知已开启", body: "站内提醒和系统通知会一起工作。", tone: "success" });
      } else {
        showInAppNotice({ title: "使用站内提醒", body: "浏览器没有允许系统通知。", tone: "muted" });
      }
    } catch (err) {
      setNotificationPermission(getNotificationPermission());
      setError(err.message || "无法开启系统通知");
    }
  }

  function recordReminderAlert(alert) {
    const nextAlert = normalizeReminderAlert(alert);
    if (!nextAlert) return;
    setReminderAlerts((current) => [nextAlert, ...current].slice(0, MAX_REMINDER_ALERTS));
    if (!reminderPanelOpen) setReminderUnread((current) => Math.min(99, current + 1));
    if (notificationEnabledRef.current && navigator?.vibrate) {
      try {
        navigator.vibrate(nextAlert.tone === "danger" ? [90, 45, 90] : [70]);
      } catch {
        // Vibration is optional.
      }
    }
  }

  function notifyWorkbench(title, body, options = {}) {
    const friendlyBody = humanizeErrorMessage(body || "");
    const key = options.key || `${title}:${body}`;
    if (key) {
      if (notifiedRunsRef.current.has(key)) return;
      notifiedRunsRef.current.add(key);
      if (notifiedRunsRef.current.size > 80) {
        notifiedRunsRef.current = new Set([...notifiedRunsRef.current].slice(-50));
      }
    }

    recordReminderAlert({
      title,
      body: friendlyBody,
      tone: options.tone || "success",
      threadId: options.threadId || ""
    });
    showInAppNotice({ title, body: friendlyBody, tone: options.tone || "success" });
    if (!notificationEnabledRef.current || getNotificationPermission() !== "granted") return;

    const notificationOptions = {
      body: friendlyBody,
      tag: key,
      renotify: false,
      data: { threadId: options.threadId || "" }
    };
    const registration = notificationRegistrationRef.current;
    if (registration?.showNotification) {
      registration.showNotification(title, notificationOptions).catch(() => {});
      return;
    }
    try {
      const notification = new Notification(title, notificationOptions);
      notification.onclick = () => window.focus?.();
    } catch {
      // Some mobile browsers expose Notification but still block page-created notifications.
    }
  }

  function patchQueueItem(queueId, patcher) {
    let updatedItem = null;
    updateSendQueue((current) =>
      current.map((item) => {
        if (item.id !== queueId) return item;
        const patch = typeof patcher === "function" ? patcher(item) : patcher;
        updatedItem = { ...item, ...patch, updatedAt: new Date().toISOString() };
        return updatedItem;
      })
    );
    if (updatedItem) {
      patchLocalQueueMessage(updatedItem.localMessageId, {
        fileMeta: updatedItem.fileMeta || [],
        fileProgress: updatedItem.fileProgress || [],
        pending: isActiveQueueItem(updatedItem),
        failed: updatedItem.stage === "failed",
        pendingStage: updatedItem.stage,
        attempts: updatedItem.attempts || 0,
        error: updatedItem.error || ""
      });
    }
    return updatedItem;
  }

  function setQueueItemFileProgress(queueId, fileIndex, progress) {
    patchQueueItem(queueId, (item) => {
      const fileProgress = Array.isArray(item.fileProgress) ? [...item.fileProgress] : [];
      fileProgress[fileIndex] = {
        ...(fileProgress[fileIndex] || {}),
        ...progress,
        updatedAt: new Date().toISOString()
      };
      return { fileProgress };
    });
  }

  function setQueueFilesState(queueId, state, extra = {}) {
    patchQueueItem(queueId, (item) => ({
      fileProgress: (item.fileMeta || []).map((file, index) => ({
        ...(item.fileProgress?.[index] || {}),
        name: file.name,
        loaded: file.size || 0,
        total: file.size || 0,
        percent: extra.percent ?? item.fileProgress?.[index]?.percent ?? 100,
        state,
        error: extra.error || ""
      }))
    }));
  }

  function updateSendQueue(updater) {
    const current = sendQueueRef.current;
    const next = typeof updater === "function" ? updater(current) : updater;
    const normalized = Array.isArray(next) ? next : [];
    sendQueueRef.current = normalized;
    setSendQueue(normalized);
  }

  function patchLocalQueueMessage(localMessageId, patch) {
    if (!localMessageId) return;
    localDraftsRef.current = localDraftsRef.current.map((message) =>
      message.id === localMessageId ? { ...message, ...patch } : message
    );
    setMessages((current) => current.map((message) => (message.id === localMessageId ? { ...message, ...patch } : message)));
  }

  function setQueueItemStage(queueId, stage, extra = {}) {
    patchQueueItem(queueId, { ...extra, stage });
  }

  function removeQueueItem(queueId) {
    updateSendQueue((current) => current.filter((item) => item.id !== queueId));
  }

  function scheduleSendQueue(delay = 0) {
    window.clearTimeout(sendQueueTimerRef.current);
    sendQueueTimerRef.current = window.setTimeout(() => {
      processSendQueue();
    }, delay);
  }

  function scheduleRecoveredQueueCheck(delay = 0) {
    window.clearTimeout(queueRecoveryTimerRef.current);
    queueRecoveryTimerRef.current = window.setTimeout(() => {
      reconcileRecoveredQueueItems().catch(() => {});
    }, delay);
  }

  function failQueueItem(item, error, options = {}) {
    if (!item) return false;
    const friendlyError = humanizeErrorMessage(error?.message || error || "Send failed");
    setQueueItemStage(item.id, "failed", {
      attempts: Number(item.attempts || 0),
      error: friendlyError,
      nextAttemptAt: "",
      fileProgress: (item.fileMeta || []).map((file, index) => ({
        ...(item.fileProgress?.[index] || {}),
        name: file.name,
        total: file.size || item.fileProgress?.[index]?.total || 0,
        state: "failed",
        error: friendlyError
      }))
    });
    setQueueFilesState(item.id, "failed", { error: friendlyError });
    if (options.notify !== false) {
      notifyWorkbench("\u53d1\u9001\u5931\u8d25", friendlyError, {
        key: `send-failed:${item.id}:${friendlyError}`,
        threadId: item.threadId,
        tone: "danger"
      });
    }
    setError(friendlyError);
    return false;
  }

  function retryQueueItem(item, error) {
    if (!item) return false;
    const attempts = Number(item.attempts || 0) + 1;
    const retryLimit = Math.max(0, Number(maxQueueAutoRetryAttempts(error) || 0));
    const friendlyError = humanizeErrorMessage(error?.message || error || "Waiting for auto-retry");
    if (!retryLimit || attempts > retryLimit) {
      return failQueueItem(
        item,
        `${friendlyError} \u81ea\u52a8\u91cd\u8bd5\u5df2\u505c\u6b62\uff0c\u8bf7\u70b9\u201c\u91cd\u8bd5\u201d\u3002`
      );
    }
    const delay = queueBackoffMs(attempts);
    setQueueItemStage(item.id, "retrying", {
      attempts,
      error: friendlyError,
      nextAttemptAt: new Date(Date.now() + delay).toISOString(),
      fileProgress: (item.fileMeta || []).map((file, index) => ({
        ...(item.fileProgress?.[index] || {}),
        name: file.name,
        total: file.size || item.fileProgress?.[index]?.total || 0,
        state: "retrying",
        error: friendlyError
      }))
    });
    scheduleSendQueue(delay);
    return true;
  }

  function retryFailedQueueItem(queueId) {
    const item = sendQueueRef.current.find((candidate) => candidate.id === queueId);
    if (!item) return;
    setQueueItemStage(queueId, "queued", {
      attempts: 0,
      error: "",
      nextAttemptAt: "",
      fileProgress: (item.fileMeta || []).map((file, index) => ({
        ...(item.fileProgress?.[index] || {}),
        name: file.name,
        loaded: item.fileProgress?.[index]?.loaded || 0,
        total: file.size || item.fileProgress?.[index]?.total || 0,
        percent: item.fileProgress?.[index]?.percent || 0,
        state: "queued"
      }))
    });
    scheduleSendQueue(0);
  }

  function dismissQueueItem(queueId) {
    const item = sendQueueRef.current.find((candidate) => candidate.id === queueId);
    if (!item) return;
    updateSendQueue((current) => current.filter((candidate) => candidate.id !== queueId));
    localDraftsRef.current = localDraftsRef.current.filter(
      (message) => message.queueId !== queueId && message.id !== item.localMessageId
    );
    setMessages((current) =>
      current.filter((message) => message.queueId !== queueId && message.id !== item.localMessageId)
    );
    if (pendingRepliesRef.current[item.threadId]?.queueId === queueId) clearPendingReply(item.threadId);
  }

  function firstActiveQueueItemForThread(threadId) {
    return sendQueueRef.current.find((item) => item.threadId === threadId && isActiveQueueItem(item)) || null;
  }

  function markThreadQueueDelivered(threadId) {
    const item = firstActiveQueueItemForThread(threadId);
    if (item && ["recovering", "submitted", "sending", "retrying"].includes(item.stage)) {
      setQueueItemStage(item.id, "delivered", { attempts: 0, error: "", nextAttemptAt: "" });
    }
  }

  function markThreadQueueSynced(threadId) {
    const item = firstActiveQueueItemForThread(threadId);
    if (!item) return;
    setQueueItemStage(item.id, "synced", { attempts: 0, error: "", nextAttemptAt: "" });
    window.setTimeout(() => {
      removeQueueItem(item.id);
      scheduleSendQueue(0);
    }, 1600);
  }

  function resolveThreadQueueFailure(threadId, error, options = {}) {
    const item = firstActiveQueueItemForThread(threadId);
    if (!item) return false;
    const friendlyError = humanizeErrorMessage(error?.message || error || "Run failed");
    if (item.stage === "retrying" && item.error === friendlyError && item.nextAttemptAt) return true;
    if (item.stage === "submitted" && isDesktopDeliveryQueueError(error)) {
      return retryQueueItem(item, error);
    }
    return failQueueItem(item, friendlyError, options);
  }

  async function reconcileRecoveredQueueItems() {
    if (queueRecoveryRef.current || !tokensRef.current?.accessToken) return;
    const recoveringItems = sendQueueRef.current.filter((item) => item.stage === "recovering");
    if (!recoveringItems.length) return;

    queueRecoveryRef.current = true;
    let shouldRetrySoon = false;
    try {
      const client = apiRef.current || api;
      const threadIds = [...new Set(recoveringItems.map((item) => item.threadId).filter(Boolean))];
      for (const threadId of threadIds) {
        const item = firstActiveQueueItemForThread(threadId);
        if (!item || item.stage !== "recovering") continue;
        const pendingReply = pendingRepliesRef.current[threadId] || pendingReplyFromQueueItem(item);
        try {
          const detail = await client.threadDetail(threadId, { limit: INITIAL_THREAD_DETAIL_PAGE_SIZE });
          const nextMessages = Array.isArray(detail?.messages) ? detail.messages : [];
          if (hasAssistantReplyAfterPendingUser(nextMessages, pendingReply)) {
            markThreadQueueSynced(threadId);
            continue;
          }
          if (hasPersistedUserMessage(nextMessages, pendingReply) || isBlockingRunState(detail?.state)) {
            markThreadQueueDelivered(threadId);
            continue;
          }
          if (pendingReply && isTerminalRunState(detail?.state)) {
            resolveThreadQueueFailure(
              threadId,
              new Error(detail?.state?.lastError || detail?.state?.phase || "This retry is no longer active"),
              { notify: false }
            );
            continue;
          }
          setQueueItemStage(item.id, "queued", { attempts: 0, error: "", nextAttemptAt: "" });
        } catch {
          shouldRetrySoon = true;
        }
      }
    } finally {
      queueRecoveryRef.current = false;
      if (shouldRetrySoon && sendQueueRef.current.some((item) => item.stage === "recovering")) {
        scheduleRecoveredQueueCheck(1500);
      } else if (sendQueueRef.current.some((item) => isQueueItemProcessable(item))) {
        scheduleSendQueue(0);
      }
    }
  }

  function setPendingReply(threadId, pendingReply) {
    pendingRepliesRef.current = { ...pendingRepliesRef.current, [threadId]: pendingReply };
    setPendingReplies(pendingRepliesRef.current);
  }

  function clearPendingReply(threadId) {
    const next = { ...pendingRepliesRef.current };
    delete next[threadId];
    pendingRepliesRef.current = next;
    setPendingReplies(next);
  }

  function updateComposerDraft(threadId, value) {
    if (!threadId) return;
    setComposerDrafts((current) => {
      const nextValue = stringifyVisibleValue(value || "");
      if (!nextValue.trim()) {
        if (!(threadId in current)) return current;
        const next = { ...current };
        delete next[threadId];
        return next;
      }
      if (current[threadId] === nextValue) return current;
      return { ...current, [threadId]: nextValue };
    });
  }

  const updateThreadStatusCaches = useCallback((threadId, runState) => {
    if (!threadId) return;
    const status = threadStatusFromRunState(runState);
    setThreads((current) => patchThreadStatusInTree(current, threadId, status));
    setProjects((current) =>
      current.map((project) => {
        const currentRecentThreads = Array.isArray(project.recentThreads) ? project.recentThreads : [];
        const nextRecentThreads = patchThreadStatusInTree(currentRecentThreads, threadId, status);
        return nextRecentThreads === currentRecentThreads ? project : { ...project, recentThreads: nextRecentThreads };
      })
    );
  }, []);

  const api = useMemo(
    () =>
      new ApiClient({
        getAccessToken: () => tokens?.accessToken,
        getRefreshToken: () => tokens?.refreshToken,
        onTokenRefresh: (refreshed) => {
          const nextTokens = { ...tokens, ...refreshed };
          storeTokens(nextTokens);
          setTokens(nextTokens);
        },
        onUnauthorized: () => {
          clearTokens();
          setTokens(null);
        }
      }),
    [tokens]
  );

  useEffect(() => {
    const url = new URL(window.location.href);
    const code = url.searchParams.get("code");
    if (!code) return;
    let cancelled = false;
    api.completePairing(code, /iPhone|iPad|iPod/.test(navigator.userAgent) ? "iPhone" : "Phone browser", browserFingerprint())
      .then((result) => {
        if (cancelled) return;
        storeTokens(result.tokens);
        storeTrustedDevice({ deviceId: result.device.id, deviceToken: result.deviceToken, name: result.device.name });
        setTrustedDevice(loadTrustedDevice());
        setTokens(result.tokens);
        window.history.replaceState({}, "", "/");
        showInAppNotice({ title: "Phone paired", body: "This device is now trusted. Next time you can use trusted login.", tone: "success" });
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  useEffect(() => {
    apiRef.current = api;
    tokensRef.current = tokens;
  }, [api, tokens]);

  const signOut = useCallback(() => {
    clearRefreshTimers();
    clearTokens();
    clearTrustedDevice();
    setTokens(null);
    setTrustedDevice(null);
    setProjects([]);
    setThreads([]);
    setSelectedProject(null);
    setSelectedThreadId(null);
    setThreadDetail(null);
    setMessages([]);
    setModelInfo({ model: "", availableModels: [] });
    setComposerDrafts({});
    setReminderAlerts([]);
    setReminderUnread(0);
    setReminderPanelOpen(false);
    clearStoredSendQueue();
    setSendQueue([]);
    sendQueueRef.current = [];
    setDiagnostics(null);
    setDiagnosticsOpen(false);
    setDiagnosticsLoading(false);
    setLoadingOlder(false);
    pendingRepliesRef.current = {};
    localDraftsRef.current = [];
    messagesRef.current = [];
    threadDetailRef.current = null;
    threadCacheRef.current = new Map();
    olderHistoryAnchorRef.current = null;
    lastAutoScrollThreadRef.current = null;
    pendingScrollRestoreRef.current = null;
    selectedThreadIdRef.current = null;
    activeProjectCwdRef.current = "";
    detailLoadRef.current = { threadId: null, requestKey: "", promise: null };
    detailReloadRequestedRef.current = null;
    detailRequestSeqRef.current = 0;
    projectsLoadRef.current = { promise: null };
    projectsRequestSeqRef.current = 0;
    threadsLoadRef.current = { projectCwd: "", promise: null };
    threadsRequestSeqRef.current = 0;
    queueRecoveryRef.current = false;
    setPendingReplies({});
    setScreen("projects");
  }, []);

  const loadProjects = useCallback(async () => {
    if (!tokens?.accessToken) return;
    if (projectsLoadRef.current.promise) return projectsLoadRef.current.promise;
    const requestSeq = ++projectsRequestSeqRef.current;
    setLoading((current) => ({ ...current, projects: true }));
    const request = (async () => {
      try {
        const nextProjects = await api.projects();
        startTransition(() => setProjects(nextProjects));
        setError("");
        return nextProjects;
      } catch (err) {
        setError(err.message);
        throw err;
      } finally {
        if (projectsRequestSeqRef.current === requestSeq) {
          setLoading((current) => ({ ...current, projects: false }));
        }
      }
    })();
    projectsLoadRef.current = { promise: request };
    try {
      return await request;
    } finally {
      if (projectsLoadRef.current.promise === request) {
        projectsLoadRef.current = { promise: null };
      }
    }
  }, [api, tokens?.accessToken]);

  const loadThreads = useCallback(
    async (projectCwd = activeProjectCwdRef.current) => {
      const targetProjectCwd = projectCwd || activeProjectCwdRef.current;
      if (!tokens?.accessToken || !targetProjectCwd) return;
      if (threadsLoadRef.current.promise && threadsLoadRef.current.projectCwd === targetProjectCwd) {
        return threadsLoadRef.current.promise;
      }
      const requestSeq = ++threadsRequestSeqRef.current;
      setLoading((current) => ({ ...current, threads: true }));
      const request = (async () => {
        try {
          const nextThreads = await api.threads(targetProjectCwd);
          if (activeProjectCwdRef.current === targetProjectCwd) {
            startTransition(() => setThreads(nextThreads));
          }
          setError("");
          return nextThreads;
        } catch (err) {
          if (activeProjectCwdRef.current === targetProjectCwd) {
            setError(err.message);
          }
          throw err;
        } finally {
          if (threadsRequestSeqRef.current === requestSeq) {
            setLoading((current) => ({ ...current, threads: false }));
          }
        }
      })();
      threadsLoadRef.current = { projectCwd: targetProjectCwd, promise: request };
      try {
        return await request;
      } finally {
        if (threadsLoadRef.current.projectCwd === targetProjectCwd && threadsLoadRef.current.promise === request) {
          threadsLoadRef.current = { projectCwd: "", promise: null };
        }
      }
    },
    [api, tokens?.accessToken]
  );

  const loadThreadDetail = useCallback(
    async (threadId = selectedThreadIdRef.current, options = {}) => {
      if (!tokens?.accessToken || !threadId) return;
      const currentThreadMessages = persistedThreadMessages(messagesRef.current, threadId);
      const beforeMessageId = options.beforeMessageId || "";
      const afterMessageId =
        options.afterMessageId !== undefined
          ? options.afterMessageId
          : beforeMessageId
            ? ""
            : currentThreadMessages.at(-1)?.id || "";
      const limit = options.limit || (beforeMessageId ? OLDER_THREAD_DETAIL_PAGE_SIZE : INITIAL_THREAD_DETAIL_PAGE_SIZE);
      const requestKey = `${threadId}|after:${afterMessageId}|before:${beforeMessageId}|limit:${limit}`;
      const olderLoad = Boolean(beforeMessageId);
      if (detailLoadRef.current.promise && detailLoadRef.current.requestKey === requestKey) {
        return detailLoadRef.current.promise;
      }
      const requestSeq = ++detailRequestSeqRef.current;
      if (olderLoad) {
        const container = messagesContainerRef.current;
        olderHistoryAnchorRef.current = container
          ? {
              threadId,
              scrollTop: container.scrollTop,
              scrollHeight: container.scrollHeight
            }
          : null;
        setLoadingOlder(true);
      } else {
        setLoading((current) => ({ ...current, detail: true }));
      }
      const request = (async () => {
        try {
          const detail = await api.threadDetail(threadId, { afterMessageId, beforeMessageId, limit });
          const nextMessages = Array.isArray(detail?.messages) ? detail.messages : [];
          const fetchedMessages =
            detail?.incremental || olderLoad ? mergeThreadMessagesById(currentThreadMessages, nextMessages, threadId) : nextMessages;
          const queueDrafts = sendQueueRef.current
            .filter((item) => item.threadId === threadId && isActiveQueueItem(item))
            .map(queueItemToLocalMessage);
          const mergedMessages = mergeFetchedMessagesWithLocalDrafts(
            fetchedMessages,
            [...messagesRef.current, ...localDraftsRef.current, ...queueDrafts],
            threadId
          );
          const history = buildThreadHistory(
            detail,
            fetchedMessages,
            threadDetailRef.current?.history || null,
            olderLoad ? "older" : detail?.incremental ? "incremental" : "latest"
          );
          localDraftsRef.current = mergedMessages.filter(
            (message) => message?.id?.startsWith("local:") && (message.pending || message.failed)
          );
          if (selectedThreadIdRef.current === threadId) {
            startTransition(() => {
              setThreadDetail({ thread: detail?.thread || null, state: detail?.state || EMPTY_STATE, history });
              setMessages(mergedMessages);
            });
            setModelInfo((current) => ({
              ...current,
              model: detail?.thread?.effectiveModel || detail?.thread?.model || current.model
            }));
          }
          const pendingReply = pendingRepliesRef.current[threadId];
          if (hasAssistantReplyAfterPendingUser(mergedMessages, pendingReply)) {
            markThreadQueueSynced(threadId);
          } else if (hasPersistedUserMessage(mergedMessages, pendingReply)) {
            markThreadQueueDelivered(threadId);
          } else if (pendingReply && isTerminalRunState(detail?.state)) {
            resolveThreadQueueFailure(
              threadId,
              new Error(detail?.state?.lastError || detail?.state?.phase || "This retry is no longer active"),
              { notify: false }
            );
          }
          setError("");
          return detail;
        } catch (err) {
          if (olderLoad) olderHistoryAnchorRef.current = null;
          if (selectedThreadIdRef.current === threadId) setError(err.message);
          throw err;
        } finally {
          if (detailRequestSeqRef.current === requestSeq) {
            if (olderLoad) {
              setLoadingOlder(false);
            } else {
              setLoading((current) => ({ ...current, detail: false }));
            }
          }
          if (!olderLoad) olderHistoryAnchorRef.current = null;
        }
      })();
      detailLoadRef.current = { threadId, requestKey, promise: request };
      try {
        return await request;
      } finally {
        if (detailLoadRef.current.threadId === threadId && detailLoadRef.current.promise === request) {
          detailLoadRef.current = { threadId: null, requestKey: "", promise: null };
        }
        if (detailReloadRequestedRef.current === threadId && selectedThreadIdRef.current === threadId) {
          detailReloadRequestedRef.current = null;
          window.setTimeout(() => {
            loadThreadDetail(threadId).catch(() => {});
          }, 80);
        }
      }
    },
    [api, tokens?.accessToken]
  );

  const refreshStatus = useCallback(async () => {
    if (!tokens?.accessToken) return;
    try {
      setStatus(await api.status());
    } catch (err) {
      setError(err.message);
    }
  }, [api, tokens?.accessToken]);

  const loadDiagnostics = useCallback(async () => {
    if (!tokens?.accessToken) return null;
    setDiagnosticsLoading(true);
    try {
      const nextStatus = await api.status({ deep: true });
      setDiagnostics(nextStatus);
      setStatus(nextStatus);
      setError("");
      return nextStatus;
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setDiagnosticsLoading(false);
    }
  }, [api, tokens?.accessToken]);

  const openDiagnostics = useCallback(() => {
    setDiagnosticsOpen(true);
    loadDiagnostics().catch(() => {});
  }, [loadDiagnostics]);

  const scheduleStatusRefresh = useCallback(
    (delay = 80) => {
      window.clearTimeout(statusRefreshTimerRef.current);
      statusRefreshTimerRef.current = window.setTimeout(() => {
        refreshStatus();
      }, delay);
    },
    [refreshStatus]
  );

  const scheduleProjectsRefresh = useCallback(
    (delay = 120) => {
      window.clearTimeout(projectsRefreshTimerRef.current);
      projectsRefreshTimerRef.current = window.setTimeout(() => {
        loadProjects();
      }, delay);
    },
    [loadProjects]
  );

  const scheduleThreadsRefresh = useCallback(
    (projectCwd = activeProjectCwdRef.current, delay = 120) => {
      const targetProjectCwd = projectCwd || activeProjectCwdRef.current;
      if (!targetProjectCwd) return;
      window.clearTimeout(threadsRefreshTimerRef.current);
      threadsRefreshTimerRef.current = window.setTimeout(() => {
        const currentProjectCwd = activeProjectCwdRef.current;
        if (!currentProjectCwd || currentProjectCwd !== targetProjectCwd) return;
        loadThreads(currentProjectCwd);
      }, delay);
    },
    [loadThreads]
  );

  const scheduleThreadDetailRefresh = useCallback(
    (threadId = selectedThreadIdRef.current, delay = 120) => {
      if (!threadId || selectedThreadIdRef.current !== threadId) return;
      window.clearTimeout(detailRefreshTimerRef.current);
      detailRefreshTimerRef.current = window.setTimeout(() => {
        if (selectedThreadIdRef.current !== threadId) return;
        if (detailLoadRef.current.promise && detailLoadRef.current.threadId === threadId) {
          detailReloadRequestedRef.current = threadId;
          return;
        }
        loadThreadDetail(threadId).catch(() => {});
      }, delay);
    },
    [loadThreadDetail]
  );

  const loadModelInfo = useCallback(async () => {
    if (!tokens?.accessToken) return;
    try {
      setModelInfo(await api.model());
    } catch (err) {
      setError(err.message);
    }
  }, [api, tokens?.accessToken]);

  const handleSocketEvent = useCallback(
    (event) => {
      const type = eventType(event);
      const threadId = event.threadId || event.thread?.id || event.payload?.threadId;
      const projectCwd = event.project?.cwd || event.cwd || event.payload?.cwd;
      const appendedMessage = event.message || event.payload?.message;
      const nextState = event.state || event.payload?.state || (type === "thread.status" ? event.payload : null);

      if (type === "message.appended" && threadId === selectedThreadIdRef.current) {
        if (appendedMessage) {
          setMessages((current) => (current.some((message) => message.id === appendedMessage.id) ? current : [...current, appendedMessage]));
        }
        else scheduleThreadDetailRefresh(threadId, 80);
      }

      if (type === "run.event" && threadId) {
        const runEvent = event.event || event.payload?.event;
        if (runEvent?.type === "desktop.delivered" && pendingRepliesRef.current[threadId]) {
          markThreadQueueDelivered(threadId);
        }
      }

      if (["thread.status", "run.started", "run.finished", "run.failed"].includes(type)) {
        const runId = event.runId || event.payload?.runId || event.turnId || event.payload?.turnId || threadId;
        if (nextState && threadId) {
          updateThreadStatusCaches(threadId, nextState);
        }
        if (nextState && threadId === selectedThreadIdRef.current) {
          setThreadDetail((current) => (current ? { ...current, state: nextState } : current));
        }
        if (type === "run.failed" && threadId) {
          resolveThreadQueueFailure(threadId, new Error(event.error || event.payload?.error || nextState?.lastError || "Run failed"), {
            notify: false
          });
        } else if (threadId && stringifyVisibleValue(nextState?.phase || "") === "cancelled") {
          resolveThreadQueueFailure(threadId, new Error(nextState?.lastError || "cancelled"), { notify: false });
        }
        scheduleStatusRefresh();
        if (threadId === selectedThreadIdRef.current) scheduleThreadDetailRefresh(threadId, 120);
        if (["run.finished", "run.failed"].includes(type) && activeProjectCwdRef.current) {
          scheduleThreadsRefresh(activeProjectCwdRef.current, 140);
        }
        if (type === "run.finished" && threadId) {
          notifyWorkbench("回复完成", "刚才那条消息已经有结果了。", {
            key: `finished:${threadId}:${runId}`,
            threadId,
            tone: "success"
          });
        }
        if (type === "run.failed" && threadId) {
          const reason = stringifyVisibleValue(event.error || event.payload?.error || nextState?.lastError || "Needs your attention");
          notifyWorkbench("回复失败", humanizeErrorMessage(reason).slice(0, 120), {
            key: `failed:${threadId}:${runId}:${reason}`,
            threadId,
            tone: "danger"
          });
        }
      }

      if (type === "thread.updated") {
        scheduleProjectsRefresh();
        if (!projectCwd || projectCwd === activeProjectCwdRef.current) {
          scheduleThreadsRefresh(projectCwd || activeProjectCwdRef.current, 140);
        }
        if (threadId === selectedThreadIdRef.current) scheduleThreadDetailRefresh(threadId, 120);
      }

      if (type === "project.updated") {
        scheduleProjectsRefresh();
        if (!projectCwd || projectCwd === activeProjectCwdRef.current) {
          scheduleThreadsRefresh(projectCwd || activeProjectCwdRef.current, 140);
        }
      }

      if (type === "model.changed") {
        const model = event.model || event.payload?.model;
        if (model) setModelInfo((current) => ({ ...current, model }));
      }
    },
    [notifyWorkbench, scheduleProjectsRefresh, scheduleStatusRefresh, scheduleThreadDetailRefresh, scheduleThreadsRefresh, updateThreadStatusCaches]
  );

  const connectionInfo = useWorkbenchSocket({ token: tokens?.accessToken, onEvent: handleSocketEvent });
  const connection = connectionInfo.state;

  const loadAuthStatus = useCallback(async () => {
    try {
      setAuthStatus(await api.authStatus());
    } catch (err) {
      setError(err.message);
    }
  }, [api]);

  useEffect(() => {
    if (!tokens?.accessToken) return;
    loadProjects();
    loadModelInfo();
    refreshStatus();
  }, [loadModelInfo, loadProjects, refreshStatus, tokens?.accessToken]);

  useEffect(() => {
    if (!tokens?.accessToken) return;
    scheduleSendQueue(connection === "online" ? 0 : 1200);
  }, [connection, sendQueue, tokens?.accessToken]);

  useEffect(() => {
    if (!tokens?.accessToken || connection !== "online") return;
    if (!sendQueue.some((item) => item.stage === "recovering")) return;
    scheduleRecoveredQueueCheck(80);
  }, [connection, sendQueue, tokens?.accessToken]);

  useEffect(() => {
    if (!tokens?.accessToken) return undefined;
    const refreshTokenQuietly = () => {
      api.refresh().catch(() => {});
    };
    const timer = window.setInterval(refreshTokenQuietly, 10 * 60 * 1000);
    window.addEventListener("online", refreshTokenQuietly);
    document.addEventListener("visibilitychange", refreshTokenQuietly);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("online", refreshTokenQuietly);
      document.removeEventListener("visibilitychange", refreshTokenQuietly);
    };
  }, [api, tokens?.accessToken]);

  useEffect(() => {
    if (connection !== "online") return;
    scheduleStatusRefresh(80);
    if (selectedThreadIdRef.current) scheduleThreadDetailRefresh(selectedThreadIdRef.current, 100);
  }, [connection, scheduleStatusRefresh, scheduleThreadDetailRefresh]);

  useEffect(() => {
    if (!tokens?.accessToken) return undefined;
    const catchUp = () => {
      if (document.visibilityState && document.visibilityState !== "visible") return;
      scheduleStatusRefresh(60);
      loadProjects().catch(() => {});
      if (activeProjectCwdRef.current) loadThreads(activeProjectCwdRef.current).catch(() => {});
      if (selectedThreadIdRef.current) scheduleThreadDetailRefresh(selectedThreadIdRef.current, 80);
      scheduleSendQueue(120);
    };
    window.addEventListener("focus", catchUp);
    window.addEventListener("pageshow", catchUp);
    document.addEventListener("visibilitychange", catchUp);
    return () => {
      window.removeEventListener("focus", catchUp);
      window.removeEventListener("pageshow", catchUp);
      document.removeEventListener("visibilitychange", catchUp);
    };
  }, [loadProjects, loadThreads, scheduleStatusRefresh, scheduleThreadDetailRefresh, tokens?.accessToken]);

  useEffect(() => {
    if (tokens?.accessToken) return;
    loadAuthStatus();
  }, [loadAuthStatus, tokens?.accessToken]);

  const lastDeferredMessageId = deferredMessages.at(-1)?.id || "";

  useEffect(() => {
    const threadChanged = lastAutoScrollThreadRef.current !== selectedThreadId;
    lastAutoScrollThreadRef.current = selectedThreadId;
    if (pendingScrollRestoreRef.current?.threadId === selectedThreadId) return;
    const container = messagesContainerRef.current;
    const distanceToBottom = container ? container.scrollHeight - container.scrollTop - container.clientHeight : 0;
    if (!threadChanged || (container && distanceToBottom > nearBottomThreshold(container))) return;
    const frame = requestAnimationFrame(() => {
      const nextContainer = messagesContainerRef.current;
      if (nextContainer) {
        nextContainer.scrollTop = nextContainer.scrollHeight;
        return;
      }
      messagesEndRef.current?.scrollIntoView({ block: "end" });
    });
    return () => cancelAnimationFrame(frame);
  }, [lastDeferredMessageId, selectedThreadId]);

  async function handleLogin(password) {
    const nextTokens = await api.login(password);
    storeTokens(nextTokens);
    setTokens(nextTokens);
  }

  async function handleTrustedLogin() {
    const trusted = loadTrustedDevice();
    if (!trusted?.deviceId || !trusted?.deviceToken) {
      clearTrustedDevice();
      setTrustedDevice(null);
      throw new Error("No trusted device token is saved. Use the password or pair this phone again.");
    }
    try {
      const nextTokens = await api.deviceLogin(trusted.deviceId, trusted.deviceToken, browserFingerprint());
      storeTokens(nextTokens);
      setTokens(nextTokens);
      setTrustedDevice({ ...trusted, name: nextTokens.device?.name || trusted.name });
    } catch (error) {
      clearTrustedDevice();
      setTrustedDevice(null);
      throw error;
    }
  }

  async function handleSetupPassword(password) {
    const nextTokens = await api.setupPassword(password);
    storeTokens(nextTokens);
    setTokens(nextTokens);
    setAuthStatus({ configured: true, setupRequired: false, source: "local" });
  }

  async function handleChangePassword(currentPassword, newPassword) {
    const nextTokens = await api.changePassword(currentPassword, newPassword);
    storeTokens(nextTokens);
    setTokens(nextTokens);
    setPasswordPanelOpen(false);
    setAuthStatus({ configured: true, setupRequired: false, source: "local" });
  }

  function openProject(project) {
    activeProjectCwdRef.current = project.cwd;
    setSelectedProject(project);
    loadThreads(project.cwd);
  }

  function openThread(threadId, threadSummary = null) {
    if (threadId === selectedThreadIdRef.current) {
      setScreen("thread");
      if (threadSummary) {
        setThreadDetail((current) =>
          current ? { ...current, thread: { ...current.thread, ...threadSummary, effectiveModel: current.thread?.effectiveModel || threadSummary.effectiveModel || threadSummary.model || "" } } : current
        );
      }
      scheduleThreadDetailRefresh(threadId, 0);
      return;
    }
    selectedThreadIdRef.current = threadId;
    detailReloadRequestedRef.current = null;
    window.clearTimeout(detailRefreshTimerRef.current);
    setSelectedThreadId(threadId);
    setScreen("thread");
    olderHistoryAnchorRef.current = null;
    pendingScrollRestoreRef.current = null;
    const cachedThread = threadCacheRef.current.get(threadId) || null;
    if (cachedThread?.detail) {
      messagesRef.current = cachedThread.messages || [];
      threadDetailRef.current = cachedThread.detail;
      setThreadDetail(cachedThread.detail);
      setMessages(cachedThread.messages || []);
      loadThreadDetail(threadId, { afterMessageId: "", limit: INITIAL_THREAD_DETAIL_PAGE_SIZE });
    } else {
      messagesRef.current = [];
      threadDetailRef.current = null;
      setThreadDetail(
        threadSummary
          ? {
              thread: {
                ...threadSummary,
                effectiveModel: threadSummary.effectiveModel || threadSummary.model || modelInfo.model || ""
              },
              state: EMPTY_STATE,
              history: null
            }
          : null
      );
      setMessages([]);
      loadThreadDetail(threadId, { limit: INITIAL_THREAD_DETAIL_PAGE_SIZE });
    }
    api.openDesktopThread(threadId).catch((err) => {
      setError(`Desktop sync failed: ${err.message}`);
    });
  }

  function openThreadFromSummary(thread) {
    const project = projects.find((item) => item.cwd === thread.cwd);
    if (project) {
      activeProjectCwdRef.current = project.cwd;
      setSelectedProject(project);
      setThreads(project.recentThreads || []);
    }
    openThread(thread.id, thread);
  }

  async function openNewDesktopThread(project = null) {
    const projectCwd = typeof project === "string" ? project : project?.cwd || activeProjectCwdRef.current || "";
    try {
      const created = await api.createThread(projectCwd ? { cwd: projectCwd } : {});
      const thread = created?.thread || null;
      if (thread?.id) {
        if (thread.cwd) {
          activeProjectCwdRef.current = thread.cwd;
          setSelectedProject({ cwd: thread.cwd, label: projectPathLabel(thread.cwd), recentThreads: [] });
        }
        openThreadFromSummary(thread);
      }
      window.setTimeout(() => {
        loadProjects().catch(() => {});
      }, 900);
      setError("");
    } catch (err) {
      try {
        await api.openDesktopNewThread();
        window.setTimeout(() => {
          loadProjects().catch(() => {});
        }, 900);
        setError("");
      } catch (fallbackErr) {
        setError(`New chat failed: ${fallbackErr.message || err.message}`);
      }
    }
  }

  async function processSendQueue() {
    if (queueProcessingRef.current || !tokensRef.current?.accessToken) return;
    const item = sendQueueRef.current.find((candidate) => isQueueItemProcessable(candidate));
    if (!item) {
      const nextAttemptAt = sendQueueRef.current
        .map((candidate) => new Date(candidate.nextAttemptAt || "").getTime())
        .filter(Number.isFinite)
        .sort((a, b) => a - b)[0];
      if (Number.isFinite(nextAttemptAt)) scheduleSendQueue(Math.max(500, nextAttemptAt - Date.now()));
      return;
    }

    const headForThread = firstActiveQueueItemForThread(item.threadId);
    if (headForThread?.id !== item.id) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      retryQueueItem(item, new Error("Device is offline"));
      return;
    }

    queueProcessingRef.current = true;
    try {
      const client = apiRef.current || api;
      let current = sendQueueRef.current.find((candidate) => candidate.id === item.id);
      if (!current || !isQueueItemProcessable(current)) return;

      if ((current.fileObjects?.length || 0) > 0 && !(current.attachmentPayloads || []).length) {
        setQueueItemStage(current.id, "preparing", { error: "", nextAttemptAt: "" });
        const attachmentPayloads = await Promise.all(
          current.fileObjects.map((file, index) =>
            fileToUploadPayload(file, (progress) => setQueueItemFileProgress(current.id, index, progress))
          )
        );
        setQueueItemStage(current.id, "queued", {
          attachmentPayloads,
          fileObjects: [],
          attachmentPersisted: true,
          fileProgress: (current.fileMeta || []).map((file, index) => ({
            ...(sendQueueRef.current.find((candidate) => candidate.id === current.id)?.fileProgress?.[index] || {}),
            name: file.name,
            loaded: file.size || 0,
            total: file.size || 0,
            percent: 100,
            state: "ready"
          }))
        });
      }

      current = sendQueueRef.current.find((candidate) => candidate.id === item.id);
      if (!current) return;
      if ((current.fileMeta?.length || 0) > 0 && !(current.attachmentPayloads || []).length && !(current.attachments || []).length) {
        setQueueItemStage(current.id, "failed", {
          error: "附件没有保留下来，请重新选择一次文件。",
          nextAttemptAt: ""
        });
        setQueueFilesState(current.id, "failed", { error: "附件没有保留下来，请重新选择一次文件。" });
        notifyWorkbench("请重新选择附件", "浏览器没有保留这个文件，请重新选择后再发送。", {
          key: `attachment-lost:${current.id}`,
          threadId: current.threadId,
          tone: "danger"
        });
        return;
      }

      if ((current.attachmentPayloads || []).length && !(current.attachments || []).length) {
        setQueueItemStage(current.id, "uploading", { error: "", nextAttemptAt: "" });
        setQueueFilesState(current.id, "uploading");
        const uploaded = await client.uploadFiles(current.attachmentPayloads);
        setQueueItemStage(current.id, "queued", {
          attachments: uploaded.uploads || [],
          attachmentPayloads: [],
          fileProgress: (current.fileMeta || []).map((file) => ({
            name: file.name,
            loaded: file.size || 0,
            total: file.size || 0,
            percent: 100,
            state: "uploaded"
          })),
          error: "",
          nextAttemptAt: ""
        });
      }

      current = sendQueueRef.current.find((candidate) => candidate.id === item.id);
      if (!current) return;
      setQueueItemStage(current.id, "sending", { error: "", nextAttemptAt: "" });
      await client.send(current.threadId, current.text, current.attachments || []);
      setQueueItemStage(current.id, "submitted", { attempts: 0, error: "", nextAttemptAt: "" });
      scheduleStatusRefresh(40);
      for (const delay of [700, 1600, 3200, 7000]) {
        window.setTimeout(() => {
          if (selectedThreadIdRef.current === current.threadId) scheduleThreadDetailRefresh(current.threadId, 0);
        }, delay);
      }
      setError("");
    } catch (err) {
      const latest = sendQueueRef.current.find((candidate) => candidate.id === item.id) || item;
      if (isRetryableQueueError(err)) {
        retryQueueItem(latest, err);
      } else {
        failQueueItem(latest, err);
      }
    } finally {
      queueProcessingRef.current = false;
      if (sendQueueRef.current.some((candidate) => isQueueItemProcessable(candidate))) scheduleSendQueue(0);
    }
  }

  function enqueueMessage(threadId, message, files = []) {
    if (!threadId) return;
    const queueItem = createSendQueueItem({ threadId, text: message, files });
    const optimisticMessage = queueItemToLocalMessage(queueItem);
    updateComposerDraft(threadId, "");
    localDraftsRef.current = [...localDraftsRef.current, optimisticMessage];
    if (selectedThreadIdRef.current === threadId) setMessages((current) => [...current, optimisticMessage]);
    updateSendQueue((current) => [...current, queueItem]);
    setError("");
    scheduleSendQueue(0);
  }

  async function sendMessage(message, files = []) {
    enqueueMessage(selectedThreadId, message, files);
  }

  async function startFreshChatWithMessage(message) {
    const value = stringifyVisibleValue(message || "").trim();
    if (!value) return;
    const created = await api.createThread(activeProjectCwdRef.current ? { cwd: activeProjectCwdRef.current } : {});
    const thread = created?.thread;
    if (!thread?.id) throw new Error("没有创建成功，请稍后再试。");
    if (thread.cwd) {
      activeProjectCwdRef.current = thread.cwd;
      setSelectedProject({ cwd: thread.cwd, label: projectPathLabel(thread.cwd), recentThreads: [] });
    }
    openThreadFromSummary(thread);
    enqueueMessage(thread.id, value, []);
    window.setTimeout(() => {
      loadProjects().catch(() => {});
    }, 900);
  }

  async function loadOlderMessages() {
    const threadId = selectedThreadIdRef.current;
    const history = threadDetailRef.current?.history;
    if (!threadId || !history?.hasOlder || loadingOlder) return;
    const oldestLoadedMessageId =
      history.oldestLoadedMessageId || persistedThreadMessages(messagesRef.current, threadId).find((message) => message?.id)?.id || "";
    if (!oldestLoadedMessageId) return;
    try {
      await loadThreadDetail(threadId, {
        beforeMessageId: oldestLoadedMessageId,
        limit: OLDER_THREAD_DETAIL_PAGE_SIZE
      });
    } catch (err) {
      setError(err.message);
    }
  }

  async function runAction(action) {
    if (!selectedThreadId) return;
    try {
      await api[action](selectedThreadId);
      if (action === "cancel") {
        const activeItem = firstActiveQueueItemForThread(selectedThreadId);
        if (activeItem) setQueueItemStage(activeItem.id, "failed", { error: "Cancelled", nextAttemptAt: "" });
      }
      await loadThreadDetail(selectedThreadId);
      await refreshStatus();
    } catch (err) {
      setError(err.message);
    }
  }

  async function changeModel(model) {
    setModelInfo((current) => ({ ...current, model }));
    try {
      setModelInfo(selectedThreadId ? await api.setThreadModel(selectedThreadId, model) : await api.setModel(model));
      setError("");
    } catch (err) {
      await loadModelInfo();
      setError(err.message);
    }
  }

  if (!tokens?.accessToken && authStatus?.setupRequired) {
    return <PasswordSetupScreen onSetup={handleSetupPassword} themeMode={themeMode} onCycleTheme={cycleThemeMode} />;
  }

  if (!tokens?.accessToken) {
    return <LoginScreen onLogin={handleLogin} onTrustedLogin={handleTrustedLogin} trustedDevice={trustedDevice} themeMode={themeMode} onCycleTheme={cycleThemeMode} />;
  }

  const runState = threadDetail?.state || EMPTY_STATE;
  const selectedDraftText = selectedThreadId ? composerDrafts[selectedThreadId] || "" : "";
  const selfRecovery = selfRecoveryState({ connectionInfo, sendQueue });
  const activeTitle = stringifyVisibleValue(screen === "thread" ? cleanThreadTitle(threadDetail?.thread?.title || "聊天") : "聊天");
  const bridgeState = status?.serviceState || status?.bridge?.state || (connection === "online" ? "ready" : connection);
  const phoneUrl = status?.publicUrl || status?.publicLink?.phoneUrl || "";
  const linkType = status?.publicLink?.tunnelType || inferPhoneLinkType(phoneUrl) || "local";

  return (
    <div className={`app-shell app-screen-${screen}`}>
      <header className="topbar" data-screen={screen}>
        <button className="ghost-button mobile-back" type="button" onClick={() => setScreen("projects")} aria-label="返回聊天列表">
          <ArrowLeft size={18} />
          <span>聊天</span>
        </button>
        <div className="brand-stack">
          <h1>{screen === "thread" ? activeTitle : "聊天"}</h1>
        </div>
        <div className="top-actions">
          <ConnectionBadge connection={connection} />
        </div>
      </header>

      {error ? (
        <div className="error-banner">
          <AlertCircle size={18} />
          <span>{humanizeErrorMessage(error)}</span>
          <button type="button" onClick={() => setError("")}>关闭</button>
        </div>
      ) : null}

      {selfRecovery ? <SelfRecoveryBanner recovery={selfRecovery} /> : null}
      {inAppNotice ? <InAppNotice notice={inAppNotice} onClose={() => setInAppNotice(null)} /> : null}

      {passwordPanelOpen ? (
        <PasswordSettingsPanel onClose={() => setPasswordPanelOpen(false)} onChangePassword={handleChangePassword} />
      ) : null}

      {diagnosticsOpen ? (
        <DiagnosticsPanel
          connection={connection}
          loading={diagnosticsLoading}
          status={diagnostics || status}
          onClose={() => setDiagnosticsOpen(false)}
          onRefresh={() => loadDiagnostics().catch(() => {})}
        />
      ) : null}

      {reminderPanelOpen ? (
        <ReminderCenterPanel
          alerts={reminderAlerts}
          enabled={notificationEnabled}
          permission={notificationPermission}
          supported={supportsCompletionNotifications()}
          onClose={closeReminderPanel}
          onToggle={toggleReminderCenter}
          onRequestSystem={requestSystemNotificationPermission}
          onClear={clearReminderAlerts}
        />
      ) : null}

      <main className={`workspace screen-${screen}`}>
        <section className="panel projects-panel">
          <PanelHeader title="聊天" isLoading={loading.projects || isPending} onRefresh={loadProjects} desktopActions />
          <ProjectList
            projects={projects}
            selectedCwd={activeProjectCwd}
            selectedThreadId={selectedThreadId}
            activeThreadId={selectedThreadId}
            activeRunState={runState}
            pendingReplies={pendingReplies}
            drafts={composerDrafts}
            status={status}
            connection={connection}
            trustedDevice={trustedDevice}
            bridgeState={bridgeState}
            linkType={linkType}
            projectCount={projects.length}
            threadCount={flattenProjectThreads(projects).length}
            onOpenDiagnostics={openDiagnostics}
            onOpenPasswordSettings={() => setPasswordPanelOpen(true)}
            onOpenReminders={openReminderPanel}
            onSignOut={signOut}
            onCycleTheme={cycleThemeMode}
            onNewChat={openNewDesktopThread}
            onNewChatForProject={openNewDesktopThread}
            onQuickStart={startFreshChatWithMessage}
            onSelectProject={openProject}
            onSelectThread={openThreadFromSummary}
            reminderUnread={reminderUnread}
            themeMode={themeMode}
          />
        </section>

        <section className="panel detail-panel">
          {screen === "thread" || threadDetail ? (
            <ThreadDetail
              detail={threadDetail}
              messages={deferredMessages}
              runState={runState}
              loading={loading.detail}
              loadingOlder={loadingOlder}
              sending={loading.sending}
              awaitingReply={selectedAwaitingReply}
              modelInfo={modelInfo}
              messagesEndRef={messagesEndRef}
              messagesContainerRef={messagesContainerRef}
              onLoadOlder={loadOlderMessages}
              onSend={sendMessage}
              onDismissQueueItem={dismissQueueItem}
              onRetryQueueItem={retryFailedQueueItem}
              onCancel={() => runAction("cancel")}
              onModelChange={changeModel}
              draftText={selectedDraftText}
              onDraftChange={(value) => updateComposerDraft(selectedThreadIdRef.current, value)}
            />
          ) : (
            <HomeChatPanel
              connection={connection}
              onQuickStart={startFreshChatWithMessage}
            />
          )}
        </section>
      </main>
    </div>
  );
}

function BridgeFlowPanel({ bridgeState, connection, linkType, onDiagnostics, projectCount, threadCount }) {
  const connectionReady = connection === "online";
  const bridgeReady = ["ready", "online", "ok"].includes(String(bridgeState || "").toLowerCase());
  const bridgeLabel = bridgeReady ? "电脑已就绪" : bridgeState === "connecting" ? "正在重连" : "需要检查";
  return (
    <section className="bridge-flow-panel compact" aria-label="连接状态">
      <div className="bridge-flow-copy">
        <p className="eyebrow">状态</p>
        <h2>{connectionReady && bridgeReady ? "可以继续聊天" : "正在恢复连接"}</h2>
        <p>{connectionReady && bridgeReady ? "电脑在线，手机消息会实时送达。" : "页面会自动重连，必要时点这里检查。"}</p>
      </div>
      <div className="bridge-flow-map">
        <article className={`flow-node windows ${bridgeReady ? "ready" : "attention"}`}>
          <span className="flow-icon"><Laptop size={20} /></span>
          <strong>电脑</strong>
          <small>{bridgeLabel}</small>
        </article>
        <span className="flow-link"><Cable size={17} /></span>
        <article className={`flow-node iphone ${connectionReady ? "ready" : "attention"}`}>
          <span className="flow-icon"><Smartphone size={20} /></span>
          <strong>手机</strong>
          <small>{connectionReady ? "实时连接" : "正在恢复"}</small>
        </article>
      </div>
      <div className="bridge-flow-stats">
        <span>{projectCount} 个项目</span>
        <span>{threadCount} 个聊天</span>
        <span>{linkType}</span>
      </div>
      <button className="bridge-diagnostics-button" type="button" onClick={onDiagnostics}>
        <Activity size={16} />
        <span>检查连接</span>
      </button>
    </section>
  );
}

function HomeChatPanel({ connection, onQuickStart }) {
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const online = connection === "online";

  async function startWithPrompt(value) {
    const nextValue = stringifyVisibleValue(value || "").trim();
    if (!nextValue || busy) return;
    setBusy(true);
    setError("");
    try {
      await onQuickStart?.(nextValue);
      setPrompt("");
    } catch (err) {
      setError(humanizeErrorMessage(err?.message || err));
    } finally {
      setBusy(false);
    }
  }

  async function submit(event) {
    event.preventDefault();
    await startWithPrompt(prompt);
  }

  return (
    <div className="home-chat-panel">
      <div className="home-chat-copy">
        <h2>有什么可以帮你？</h2>
      </div>
      <form className={"home-chat-composer " + (online ? "" : "recovering")} onSubmit={submit}>
        <textarea
          aria-label="开始新聊天"
          enterKeyHint="send"
          placeholder="问任何问题"
          rows={4}
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.shiftKey || event.nativeEvent?.isComposing) return;
            event.preventDefault();
            submit(event);
          }}
        />
        <div className="home-chat-actions">
          <span className="home-chat-hint">{online ? "Enter 发送，Shift + Enter 换行" : "正在恢复连接，写好后会继续发送"}</span>
          <button className="primary-button" type="submit" disabled={!prompt.trim() || busy}>
            {busy ? <Loader2 className="spin" size={18} /> : <Send size={18} />}
            <span>发送</span>
          </button>
        </div>
        {error ? <p>{error}</p> : null}
      </form>
    </div>
  );
}

function ModelSelector({ modelInfo, onChange }) {
  const models = modelInfo.availableModels?.length ? modelInfo.availableModels : [modelInfo.model].filter(Boolean);
  if (!models.length) return null;
  return (
    <label className="model-selector">
      <span>模型</span>
      <select value={modelInfo.model || models[0]} onChange={(event) => onChange(event.target.value)}>
        {models.map((model) => (
          <option key={model} value={model}>
            {model}
          </option>
        ))}
      </select>
    </label>
  );
}

function LoginScreen({ onLogin, onTrustedLogin, trustedDevice, themeMode, onCycleTheme }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [trustedBusy, setTrustedBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await onLogin(password);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function signInTrusted() {
    setTrustedBusy(true);
    setError("");
    try {
      await onTrustedLogin();
    } catch (err) {
      setError(err.message);
    } finally {
      setTrustedBusy(false);
    }
  }

  return (
    <main className="login-screen">
      <div className="login-theme-control">
        <ThemeToggle mode={themeMode} onClick={onCycleTheme} />
      </div>
      <form className="login-card" onSubmit={submit}>
        <div className="login-device-stage" aria-label="用手机继续电脑上的聊天">
          <div className="login-window-card">
            <div className="login-window-bar">
              <span />
              <span />
              <span />
            </div>
            <strong>电脑端</strong>
            <small>运行、文件、同步</small>
            <div className="login-window-terminal">
              <span>chat ready</span>
              <span>sync on</span>
              <span>files ready</span>
            </div>
          </div>
          <div className="login-phone-frame">
            <span className="login-phone-notch" />
            <Smartphone size={28} />
            <strong>手机端</strong>
            <small>配对一次，随身继续</small>
          </div>
        </div>
        <div className="login-bridge-strip" aria-label="远程链路">
          <span><Laptop size={18} /> 电脑</span>
          <i />
          <span><Cable size={18} /> 同步</span>
          <i />
          <span><Smartphone size={18} /> 手机</span>
        </div>
        <div className="login-mark">
          <Cable size={28} />
        </div>
        <p className="eyebrow">随身继续</p>
        <h1>聊天</h1>
        <p className="muted">从手机继续电脑上的聊天，搜索、续聊、传附件都放在一个自然的入口里。</p>
        <div className="login-capabilities" aria-label="核心能力">
          <span>扫码配对</span>
          <span>信任登录</span>
          <span>断线恢复</span>
        </div>
        {trustedDevice ? (
          <button className="primary-button trusted-login-button" disabled={trustedBusy} type="button" onClick={signInTrusted}>
            {trustedBusy ? <Loader2 className="spin" size={18} /> : <CheckCircle2 size={18} />}
            信任登录{trustedDevice.name ? `：${trustedDevice.name}` : ""}
          </button>
        ) : null}
        {trustedDevice ? <p className="muted small">如果信任登录失败，用下面的密码登录，或回到电脑端重新配对。</p> : null}
        <label>
          访问密码
          <input autoComplete="current-password" autoFocus type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
        </label>
        {error ? <p className="form-error">{humanizeErrorMessage(error)}</p> : null}
        <button className="primary-button" disabled={busy || !password.trim()} type="submit">
          {busy ? <Loader2 className="spin" size={18} /> : <Wifi size={18} />}
          进入
        </button>
      </form>
    </main>
  );
}

function PasswordSetupScreen({ onSetup, themeMode, onCycleTheme }) {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setError("");
    if (password.length < 4) {
      setError("密码至少需要 4 位。");
      return;
    }
    if (password !== confirmPassword) {
      setError("两次输入的密码不一致。");
      return;
    }
    setBusy(true);
    try {
      await onSetup(password);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-screen">
      <div className="login-theme-control">
        <ThemeToggle mode={themeMode} onClick={onCycleTheme} />
      </div>
      <form className="login-card" onSubmit={submit}>
        <div className="login-mark">
          <LockKeyhole size={28} />
        </div>
        <p className="eyebrow">首次设置</p>
        <h1>设置访问密码</h1>
        <p className="muted">先设置手机访问密码，然后就能打开电脑上的聊天。</p>
        <label>
          新密码
          <input autoComplete="new-password" autoFocus type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
        </label>
        <label>
          确认密码
          <input autoComplete="new-password" type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} />
        </label>
        {error ? <p className="form-error">{humanizeErrorMessage(error)}</p> : null}
        <button className="primary-button" disabled={busy || !password || !confirmPassword} type="submit">
          {busy ? <Loader2 className="spin" size={18} /> : <LockKeyhole size={18} />}
          立即启用
        </button>
      </form>
    </main>
  );
}

function PasswordSettingsPanel({ onClose, onChangePassword }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setError("");
    if (newPassword.length < 4) {
      setError("新密码至少需要 4 位。");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("两次输入的新密码不一致。");
      return;
    }
    setBusy(true);
    try {
      await onChangePassword(currentPassword, newPassword);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <form className="password-panel" onSubmit={submit} onMouseDown={(event) => event.stopPropagation()}>
        <div className="password-panel-header">
          <div>
            <p className="eyebrow">安全</p>
            <h2>修改密码</h2>
          </div>
          <button className="ghost-button" type="button" onClick={onClose} aria-label="关闭密码设置">
            <X size={16} />
          </button>
        </div>
        <p className="muted">修改后，手机下次登录会要求输入新密码。</p>
        <label>
          当前密码
          <input autoComplete="current-password" type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} />
        </label>
        <label>
          新密码
          <input autoComplete="new-password" type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} />
        </label>
        <label>
          确认新密码
          <input autoComplete="new-password" type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} />
        </label>
        {error ? <p className="form-error">{humanizeErrorMessage(error)}</p> : null}
        <button className="primary-button" disabled={busy || !currentPassword || !newPassword || !confirmPassword} type="submit">
          {busy ? <Loader2 className="spin" size={18} /> : <LockKeyhole size={18} />}
          保存密码
        </button>
      </form>
    </div>
  );
}

function SelfRecoveryBanner({ recovery }) {
  if (!recovery) return null;
  return (
    <div className={`self-recovery-banner ${recovery.tone || "warning"}`}>
      <Loader2 className="spin" size={17} />
      <span>
        <strong>{recovery.label}</strong>
        {recovery.detail ? <em>{recovery.detail}</em> : null}
      </span>
    </div>
  );
}

function ReminderCenterButton({ enabled, unreadCount = 0, onOpen }) {
  const label = unreadCount ? `提醒，${unreadCount} 条未读` : "提醒";
  return (
    <button
      className={`icon-button reminder-button ${enabled ? "active" : ""}`}
      type="button"
      onClick={onOpen}
      aria-label={label}
      title={label}
    >
      {unreadCount ? <BellRing size={18} /> : <Bell size={18} />}
      {unreadCount ? <span className="reminder-badge">{Math.min(99, unreadCount)}</span> : null}
    </button>
  );
}

function ReminderCenterPanel({ alerts, enabled, permission, supported, onClose, onToggle, onRequestSystem, onClear }) {
  const systemReady = supported && permission === "granted";
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="提醒" onMouseDown={onClose}>
      <section className="reminder-panel" onMouseDown={(event) => event.stopPropagation()}>
        <div className="password-panel-header">
          <div>
            <p className="eyebrow">提醒</p>
            <h2>任务提醒</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="关闭提醒">
            <X size={18} />
          </button>
        </div>
        <div className="reminder-controls">
          <button className={`secondary-button ${enabled ? "active" : ""}`} type="button" onClick={onToggle}>
            {enabled ? <BellRing size={16} /> : <Bell size={16} />}
            {enabled ? "已开启" : "已关闭"}
          </button>
          <button className={`secondary-button ${systemReady ? "active" : ""}`} type="button" onClick={onRequestSystem}>
            {systemReady ? <CheckCircle2 size={16} /> : <BellOff size={16} />}
            系统通知
          </button>
          {alerts.length ? (
            <button className="secondary-button danger" type="button" onClick={onClear}>
              清空
            </button>
          ) : null}
        </div>
        <div className="reminder-list">
          {alerts.length ? (
            alerts.map((alert) => (
              <article className={`reminder-item ${alert.tone}`} key={alert.id}>
                <span className="reminder-icon">{alert.tone === "danger" ? <AlertCircle size={16} /> : <CheckCircle2 size={16} />}</span>
                <span>
                  <strong>{alert.title}</strong>
                  {alert.body ? <em>{alert.body}</em> : null}
                  <time>{formatRelative(alert.createdAt)}</time>
                </span>
              </article>
            ))
          ) : (
            <div className="diagnostic-empty">
              <Bell size={18} />
              还没有提醒
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function InAppNotice({ notice, onClose }) {
  if (!notice) return null;
  return (
    <div className={`in-app-notice ${notice.tone || "success"}`} role="status">
      <span>
        <strong>{notice.title}</strong>
        {notice.body ? <em>{notice.body}</em> : null}
      </span>
      <button type="button" onClick={onClose} aria-label="关闭提醒">
        <X size={14} />
      </button>
    </div>
  );
}

function DiagnosticsPanel({ status, loading, connection, onRefresh, onClose }) {
  const diagnostics = status?.diagnostics || {};
  const checks = diagnostics.checks || status?.checks || [];
  const overall = diagnostics.overall || status?.overall || (checks.some((check) => check.status === "error") ? "error" : checks.some((check) => check.status === "warning") ? "warning" : "ok");
  const phoneUrl = status?.publicUrl || status?.publicLink?.phoneUrl || "";
  const localUrl = status?.localUrl || status?.publicLink?.localUrl || "";
  const publicLink = status?.publicLink || {};
  const summaryLabel = diagnostics.label || diagnosticSummaryLabel(overall);
  const connectionLabel = connection === "online" ? "在线" : connection === "connecting" ? "连接中" : "离线";
  const metaItems = [
    { label: "手机网址", value: phoneUrl || "未就绪", copy: phoneUrl },
    { label: "连接类型", value: publicLink.tunnelType || inferPhoneLinkType(phoneUrl) },
    { label: "网址稳定性", value: publicLink.failureReason ? `正在恢复：${publicLink.failureReason}` : publicLink.stable ? "固定网址" : phoneUrl ? "临时网址" : "未就绪" },
    { label: "电脑网址", value: localUrl || "未知", copy: localUrl },
    { label: "电脑端状态", value: status?.serviceState || status?.bridge?.state || "未知" },
    { label: "实时连接", value: `${connectionLabel}${Number.isFinite(status?.webClients) ? ` / ${status.webClients} 个网页端` : ""}` },
    { label: "发送模式", value: status?.sendMode || "未知" },
    { label: "模型", value: status?.model || "未知" },
    { label: "正在回复", value: String(status?.activeRuns ?? 0) },
    { label: "检查时间", value: formatDiagnosticTime(diagnostics.checkedAt || status?.checkedAt) }
  ];

  async function copyValue(value) {
    if (!value || typeof navigator === "undefined" || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // Clipboard is optional in some mobile browsers.
    }
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="连接诊断">
      <section className={`diagnostics-panel ${overall}`}>
        <div className="password-panel-header">
          <div>
            <p className="eyebrow">诊断</p>
            <h2>连接诊断</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="关闭诊断">
            <X size={18} />
          </button>
        </div>

        <div className={`diagnostics-summary ${overall}`}>
          <div className="diagnostics-summary-icon">
            {overall === "ok" ? <CheckCircle2 size={22} /> : <AlertCircle size={22} />}
          </div>
          <div>
            <strong>{loading ? "正在检查..." : summaryLabel}</strong>
            <span>
              {loading
                ? "正在检查手机网址、聊天记录和电脑端连接。"
                : `正常 ${diagnostics.ok ?? checks.filter((check) => check.status === "ok").length}，警告 ${diagnostics.warnings ?? checks.filter((check) => check.status === "warning").length}，错误 ${diagnostics.errors ?? checks.filter((check) => check.status === "error").length}`}
            </span>
          </div>
          <button className="secondary-button" type="button" onClick={onRefresh} disabled={loading}>
            <RefreshCw className={loading ? "spin" : ""} size={16} />
            重新检查
          </button>
        </div>

        <div className="diagnostics-meta">
          {metaItems.map((item) => {
            const value = stringifyVisibleValue(item.value);
            const isLink = /^https?:\/\//i.test(value);
            return (
              <div className="diagnostic-meta-item" key={item.label}>
                <span>{item.label}</span>
                <strong>
                  {isLink ? (
                    <a href={value} target="_blank" rel="noreferrer">
                      {value}
                    </a>
                  ) : (
                    value
                  )}
                </strong>
                {item.copy ? (
                  <button className="diagnostic-copy" type="button" onClick={() => copyValue(item.copy)} aria-label={`复制${item.label}`}>
                    <Copy size={14} />
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>

        <div className="diagnostic-checks">
          {checks.length ? (
            checks.map((check) => (
              <div className={`diagnostic-check ${check.status}`} key={check.id || check.label}>
                <div className="diagnostic-check-icon">
                  {check.status === "ok" ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
                </div>
                <div>
                  <div className="diagnostic-check-title">
                    <strong>{check.label}</strong>
                    <span>{diagnosticStatusLabel(check.status)}</span>
                  </div>
                  {check.detail ? <p>{diagnosticDetailText(check)}</p> : null}
                  {check.action ? <small>{check.action}</small> : null}
                </div>
              </div>
            ))
          ) : (
            <div className="diagnostic-empty">
              <Loader2 className="spin" size={18} />
              正在加载诊断信息...
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function PanelHeader({ title, subtitle, isLoading, onRefresh, desktopActions = false }) {
  return (
    <div className="panel-header">
      <div>
        <h2>{title}</h2>
        {subtitle ? <p>{subtitle}</p> : null}
      </div>
      {desktopActions ? (
        <div className="desktop-header-actions" aria-label={`${title}操作`}>
          <span aria-hidden="true"><Maximize2 size={16} /></span>
          <button type="button" onClick={onRefresh} disabled={isLoading} aria-label={`刷新${title}`}>
            <ListFilter className={isLoading ? "spin" : ""} size={16} />
          </button>
          <span aria-hidden="true"><FolderPlus size={16} /></span>
        </div>
      ) : (
        <button className="icon-button" type="button" onClick={onRefresh} disabled={isLoading} aria-label={`刷新${title}`}>
          <RefreshCw className={isLoading ? "spin" : ""} size={17} />
        </button>
      )}
    </div>
  );
}

function ConnectionBadge({ connection }) {
  const online = connection === "online";
  const label = connection === "online" ? "在线" : connection === "connecting" ? "连接中" : "离线";
  return (
    <span className={`connection-badge ${online ? "online" : ""}`}>
      {online ? <Wifi size={14} /> : <WifiOff size={14} />}
      {label}
    </span>
  );
}

function ThemeToggle({ mode, onClick }) {
  const config = {
    auto: { label: "跟随系统", icon: <Monitor size={16} /> },
    light: { label: "浅色", icon: <Sun size={16} /> },
    dark: { label: "深色", icon: <Moon size={16} /> }
  }[mode] || { label: "跟随系统", icon: <Monitor size={16} /> };
  return (
    <button className="theme-toggle" type="button" onClick={onClick} aria-label={"切换主题：" + config.label}>
      {config.icon}
      <span>{config.label}</span>
    </button>
  );
}

export function ProjectList({ projects, selectedCwd, selectedThreadId, activeThreadId, activeRunState, pendingReplies, drafts, status, connection, trustedDevice, bridgeState, linkType, projectCount, threadCount, onOpenDiagnostics, onOpenPasswordSettings, onOpenReminders, onSignOut, onCycleTheme, onNewChat, onNewChatForProject, onQuickStart, onSelectProject, onSelectThread, reminderUnread = 0, themeMode = "auto" }) {
  const [expandedAgentThreads, setExpandedAgentThreads] = useState(() => new Set());
  const [expandedProjects, setExpandedProjects] = useState(() => new Set());
  const [archiveExpanded, setArchiveExpanded] = useState(false);
  const [sidebarQuery, setSidebarQuery] = useState("");
  const [threadPreferences, setThreadPreferences] = useState(() => loadStoredThreadPreferences());
  const searchInputRef = useRef(null);
  const deferredSidebarQuery = useDeferredValue(sidebarQuery);
  const preferredProjects = useMemo(() => applyThreadPreferencesToProjects(projects, threadPreferences), [projects, threadPreferences]);
  const filteredProjects = useMemo(() => filterProjectsForQuery(preferredProjects, deferredSidebarQuery), [preferredProjects, deferredSidebarQuery]);
  const searchActive = Boolean(normalizeSearchQuery(deferredSidebarQuery));
  const allThreads = useMemo(() => sortFlatThreads(flattenProjectThreads(filteredProjects), threadPreferences), [filteredProjects, threadPreferences]);
  const totalThreadCount = useMemo(() => sortFlatThreads(flattenProjectThreads(preferredProjects), threadPreferences).length, [preferredProjects, threadPreferences]);
  const pinnedThreads = useMemo(() => preferredThreads(allThreads, threadPreferences, "pinned"), [allThreads, threadPreferences]);
  const recentThreads = useMemo(() => {
    if (searchActive) return allThreads;
    return allThreads.filter((thread) => !threadPreferences.pinned?.[thread.id]);
  }, [allThreads, searchActive, threadPreferences.pinned]);
  const recentThreadGroups = useMemo(() => groupThreadsByDate(recentThreads), [recentThreads]);
  const archiveProjects = archiveExpanded ? filteredProjects : filteredProjects.slice(0, 12);
  const hiddenArchiveProjectCount = Math.max(0, filteredProjects.length - archiveProjects.length);
  const searchResultCount = allThreads.length;
  const shouldShowProjectArchive = searchActive ? false : archiveExpanded;
  const hasUtilityHandlers = Boolean(onOpenReminders || onCycleTheme || onOpenDiagnostics || onOpenPasswordSettings || onSignOut);

  useEffect(() => {
    storeThreadPreferences(threadPreferences);
  }, [threadPreferences]);

  useEffect(() => {
    const handleShortcut = (event) => {
      const target = event.target;
      const typing = target?.isContentEditable || target?.matches?.("input, textarea, select");
      if (typing) return;
      if ((event.ctrlKey || event.metaKey) && event.key?.toLowerCase() === "k") {
        event.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, []);

  function toggleAgents(threadId) {
    setExpandedAgentThreads((current) => {
      const next = new Set(current);
      if (next.has(threadId)) next.delete(threadId);
      else next.add(threadId);
      return next;
    });
  }

  function toggleProject(projectCwd) {
    setExpandedProjects((current) => {
      const next = new Set(current);
      if (next.has(projectCwd)) next.delete(projectCwd);
      else next.add(projectCwd);
      return next;
    });
  }

  function toggleThreadPreference(threadId, key) {
    setThreadPreferences((current) => {
      const next = normalizeThreadPreferences(current);
      const collection = { ...next[key] };
      if (collection[threadId]) delete collection[threadId];
      else collection[threadId] = new Date().toISOString();
      return { ...next, [key]: collection };
    });
  }

  function renameThread(thread) {
    const currentTitle = threadDisplayTitle(thread, threadPreferences) || stringifyVisibleValue(thread.title || "");
    const nextTitle = window.prompt("重命名对话", currentTitle);
    if (nextTitle === null) return;
    setThreadPreferences((current) => {
      const next = normalizeThreadPreferences(current);
      const aliases = { ...next.aliases };
      const trimmed = nextTitle.trim();
      if (!trimmed || trimmed === thread.title) delete aliases[thread.id];
      else aliases[thread.id] = trimmed;
      return { ...next, aliases };
    });
    if (thread.id === selectedThreadId) {
      const trimmed = nextTitle.trim();
      onSelectThread({ ...thread, title: trimmed || thread.title });
    }
  }

  function selectThread(thread) {
    onSelectThread({ ...thread, title: threadDisplayTitle(thread, threadPreferences) || thread.title });
  }

  function startProjectChat(event, project) {
    event.preventDefault();
    event.stopPropagation();
    onNewChatForProject?.(project);
  }

  function renderThreadBranch(thread, extraClass = "", sourceLabel = "") {
    const allSubagents = thread.subagents || [];
    const expanded = expandedAgentThreads.has(thread.id) || searchActive;
    const visibleSubagents = expanded ? allSubagents : [];
    const hasSubagents = allSubagents.length > 0;
    const pendingReply = pendingReplies?.[thread.id] || null;
    const isRunning = (thread.id === activeThreadId && isBlockingRunState(activeRunState)) || thread.status === "running";
    const statusInfo = threadListStatus({ thread, pendingReply, isRunning });
    const draftPreview = summarizeDraft(drafts?.[thread.id]);
    const rawTitle = stringifyVisibleValue(threadDisplayTitle(thread, threadPreferences) || "Untitled Thread");
    const displayTitle = compactVisibleValue(rawTitle, 72);
    const isPinned = Boolean(threadPreferences.pinned?.[thread.id]);
    const secondaryText = draftPreview || (statusInfo?.busy || statusInfo?.key === "failed" ? statusInfo.label : "");
    const threadAriaLabel = [
      sourceLabel,
      compactVisibleValue(rawTitle, 140),
      statusInfo?.label,
      thread.updatedAt ? "更新 " + formatRelative(thread.updatedAt) : ""
    ].filter(Boolean).join(" - ");

    return (
      <div className={"desktop-thread-branch " + extraClass} key={thread.id}>
        <button className={`desktop-thread-row status-${statusInfo.key} ${thread.id === selectedThreadId ? "active" : ""}`} type="button" aria-label={threadAriaLabel} title={threadAriaLabel} onClick={() => selectThread(thread)}>
          <span className="thread-row-indicator" aria-hidden="true" />
          <span className="thread-row-main">
            <strong>{displayTitle}</strong>
            {secondaryText ? <small>{secondaryText}</small> : null}
          </span>
          <ThreadListMeta updatedAt={thread.updatedAt} statusInfo={statusInfo} draftPreview={draftPreview} />
          <ThreadQuickActions
            pinned={isPinned}
            onPin={() => toggleThreadPreference(thread.id, "pinned")}
            onRename={() => renameThread(thread)}
          />
        </button>
        {hasSubagents ? (
          <button className="agent-toggle" type="button" onClick={() => toggleAgents(thread.id)}>
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <span>{expanded ? "收起子任务 " + allSubagents.length : "查看子任务 " + allSubagents.length}</span>
          </button>
        ) : null}
        {visibleSubagents.length ? (
          <div className="subagent-list">
            {visibleSubagents.map((subagent) => (
              <button className={"subagent-row " + (subagent.id === selectedThreadId ? "active" : "")} key={subagent.id} type="button" onClick={() => selectThread(subagent)}>
                <Bot size={14} />
                <span>
                  <strong>{stringifyVisibleValue(subagent.agentNickname || subagent.agentRole || "Agent")}</strong>
                  {compactVisibleValue(cleanThreadTitle(subagent.title || "子任务"), 80)}
                </span>
                <time>{formatDesktopRelative(subagent.updatedAt)}</time>
              </button>
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  const sidebarSubtitle = [connection === "online" ? "已同步" : "同步中", totalThreadCount ? `${totalThreadCount} 条` : ""]
    .filter(Boolean)
    .join(" · ");
  const recentTitle = searchActive ? "搜索结果" : "历史记录";

  return (
    <div className="desktop-nav remodex-sidebar">
      <header className="remodex-sidebar-header">
        <div className="remodex-sidebar-title">
          <span>
            <strong>聊天</strong>
            <small>{sidebarSubtitle}</small>
          </span>
        </div>
        {hasUtilityHandlers ? (
          <details className="sidebar-menu">
            <summary className="remodex-circle-button" aria-label="更多">
              <ListFilter size={17} />
            </summary>
            <div className="sidebar-menu-panel">
              {onOpenReminders ? (
                <button type="button" onClick={onOpenReminders}>
                  <Bell size={15} />
                  <span>提醒</span>
                  {reminderUnread ? <small>{reminderUnread}</small> : null}
                </button>
              ) : null}
              {onCycleTheme ? (
                <button type="button" onClick={onCycleTheme}>
                  {themeMode === "dark" ? <Moon size={15} /> : themeMode === "light" ? <Sun size={15} /> : <Monitor size={15} />}
                  <span>外观</span>
                </button>
              ) : null}
              {onOpenDiagnostics ? (
                <button type="button" onClick={onOpenDiagnostics}>
                  <Activity size={15} />
                  <span>状态</span>
                </button>
              ) : null}
              {onOpenPasswordSettings ? (
                <button type="button" onClick={onOpenPasswordSettings}>
                  <LockKeyhole size={15} />
                  <span>密码</span>
                </button>
              ) : null}
              {onSignOut ? (
                <button type="button" onClick={onSignOut}>
                  <LogOut size={15} />
                  <span>退出</span>
                </button>
              ) : null}
            </div>
          </details>
        ) : null}
      </header>

      <button className="remodex-new-chat" type="button" onClick={onNewChat} title="创建新聊天">
        <span><Plus size={19} /></span>
        <strong>新聊天</strong>
      </button>

      <label className="agent-search primary-search">
        <Search size={14} />
        <input ref={searchInputRef} value={sidebarQuery} onChange={(event) => setSidebarQuery(event.target.value)} placeholder="搜索" />
        <kbd>Ctrl K</kbd>
      </label>
      {searchActive ? <p className="search-summary">找到 {searchResultCount} 条</p> : null}

      {!projects.length ? (
        <EmptyState icon={<FolderGit2 />} title="还没有聊天" body="点新聊天开始第一条。" />
      ) : null}

      {!searchActive && pinnedThreads.length ? (
        <section className="desktop-section pinned-section">
          <div className="desktop-section-heading">
            <div className="desktop-section-title">置顶</div>
            <div className="desktop-section-actions" aria-hidden="true">
              <Pin size={15} />
            </div>
          </div>
          {pinnedThreads.map((thread) => renderThreadBranch(thread, "conversation-row pinned-row", projectPathLabel(thread.cwd || "")))}
        </section>
      ) : null}

      {recentThreads.length ? (
        <section className="desktop-section recent-section">
          <div className="desktop-section-heading">
            <div className="desktop-section-title">{recentTitle}</div>
            <div className="desktop-section-actions" aria-hidden="true">
              <Clock3 size={15} />
            </div>
          </div>
          {recentThreadGroups.map((group) => (
            <div className="thread-date-group" key={group.label}>
              <div className="thread-date-label">{group.label}</div>
              {group.threads.map((thread) => renderThreadBranch(thread, "conversation-row recent-row", projectPathLabel(thread.cwd || "")))}
            </div>
          ))}
        </section>
      ) : searchActive ? (
        <EmptyState icon={<Search />} title="没有找到聊天" body="换个关键词试试，或直接开始一段新聊天。" />
      ) : null}

      {!searchActive && projects.length ? (
        <button className="project-archive-toggle" type="button" onClick={() => setArchiveExpanded((current) => !current)} aria-expanded={archiveExpanded}>
          <span><FolderGit2 size={15} /> 项目</span>
          <small>{archiveExpanded ? "收起" : "展开"}</small>
        </button>
      ) : null}

      {shouldShowProjectArchive ? <section className="desktop-section project-archive-section">
        {archiveProjects.map((project) => {
          const projectLabel = compactVisibleValue(project.label || projectPathLabel(project.cwd), 56);
          const projectThreads = project.recentThreads || [];
          const expanded = expandedProjects.has(project.cwd);
          const visibleThreads = expanded ? projectThreads : [];
          const hiddenCount = Math.max(0, projectThreads.length - visibleThreads.length);
          return (
          <div className="desktop-project-group" key={project.cwd}>
            <div className={"desktop-folder-row " + (project.cwd === selectedCwd ? "active" : "")}>
              <button className="desktop-folder-toggle" type="button" onClick={() => { onSelectProject(project); toggleProject(project.cwd); }} aria-expanded={expanded}>
                <span className="folder-leading-icon" aria-hidden="true">{expanded ? <ChevronDown size={17} /> : <ChevronRight size={17} />}</span>
                <span>{projectLabel}</span>
              </button>
              <small>{projectThreads.length}</small>
              <button className="project-new-chat-button" type="button" onClick={(event) => startProjectChat(event, project)} aria-label={`在 ${projectLabel} 新建对话`} title={`在 ${projectLabel} 新建对话`}>
                <FolderPlus size={15} />
              </button>
            </div>
            <div className="desktop-thread-group">
              {visibleThreads.map((thread) => renderThreadBranch(thread, "", projectLabel))}
              {hiddenCount ? (
                <button className="project-show-more" type="button" onClick={() => toggleProject(project.cwd)}>
                  展开 {hiddenCount} 条
                </button>
              ) : null}
            </div>
          </div>
          );
        })}
        {hiddenArchiveProjectCount ? null : archiveExpanded && filteredProjects.length > 12 ? (
          <button className="project-show-more archive-show-more" type="button" onClick={() => setArchiveExpanded(false)}>
            收起项目归档
          </button>
        ) : null}
      </section> : null}
    </div>
  );
}

function ThreadQuickActions({ pinned, onPin, onRename }) {
  function run(event, handler) {
    event.preventDefault();
    event.stopPropagation();
    handler?.();
  }

  function keyRun(event, handler) {
    if (event.key !== "Enter" && event.key !== " ") return;
    run(event, handler);
  }

  return (
    <span className="thread-row-actions" aria-label="对话操作">
      <span className={pinned ? "active" : ""} role="button" tabIndex={0} title="置顶" onClick={(event) => run(event, onPin)} onKeyDown={(event) => keyRun(event, onPin)}>
        <Pin size={13} />
      </span>
      <span role="button" tabIndex={0} title="重命名" onClick={(event) => run(event, onRename)} onKeyDown={(event) => keyRun(event, onRename)}>
        <PencilLine size={13} />
      </span>
    </span>
  );
}

function ThreadListMeta({ updatedAt, statusInfo, draftPreview = "" }) {
  const showStatus = statusInfo?.label && !["complete", "idle"].includes(statusInfo.key);
  if (!draftPreview && !showStatus && !statusInfo?.busy) return null;
  return (
    <span className="thread-list-meta">
      {draftPreview ? <span className="thread-draft-dot" title={draftPreview} aria-label="有草稿" /> : null}
      {statusInfo?.busy ? <span className="thread-spinner" aria-label={statusInfo.label} /> : null}
      {showStatus && !statusInfo?.busy ? <span className={`thread-status-dot ${statusInfo.key}`} title={statusInfo.label} aria-label={statusInfo.label} /> : null}
    </span>
  );
}

function ThreadList({ threads, selectedThreadId, onSelect }) {
  if (!threads.length) return <EmptyState icon={<MessageSquare />} title="还没有聊天" body="发出第一条消息后，这里会自动同步。" />;

  return (
    <div className="list">
      {threads.map((thread) => (
        <button className={"list-card thread-card " + (thread.id === selectedThreadId ? "active" : "")} key={thread.id} type="button" onClick={() => onSelect(thread.id)}>
          <MessageSquare size={19} />
          <span className="list-card-main">
            <strong>{compactVisibleValue(cleanThreadTitle(thread.title || DEFAULT_THREAD_TITLE), 72)}</strong>
            <small>{thread.gitBranch ? thread.gitBranch + " - " : ""}{formatRelative(thread.updatedAt)}</small>
          </span>
          <span className={"status-dot " + (thread.status || "idle")} />
        </button>
      ))}
    </div>
  );
}

function ThreadDetail({
  detail,
  messages,
  runState,
  loading,
  loadingOlder,
  sending,
  awaitingReply,
  modelInfo,
  messagesEndRef,
  messagesContainerRef,
  onLoadOlder,
  onSend,
  onDismissQueueItem,
  onRetryQueueItem,
  onCancel,
  onModelChange,
  draftText,
  onDraftChange
}) {
  const [isNearBottom, setIsNearBottom] = useState(true);
  const [hasNewActivity, setHasNewActivity] = useState(false);
  const lastMessageIdRef = useRef("");
  const autoLoadOlderArmedRef = useRef(true);
  const initialLatestScrollRef = useRef({ threadId: "", done: false });
  const pinnedToLatestRef = useRef(true);
  const scrollStateFrameRef = useRef(0);
  const userScrollHoldUntilRef = useRef(0);
  const virtualListRef = useRef(null);

  function keepComposerVisible() {
    const scrollMessagesToBottom = () => {
      const container = messagesContainerRef.current;
      if (container) {
        container.scrollTop = container.scrollHeight;
        return;
      }
      messagesEndRef.current?.scrollIntoView({ block: "end" });
    };
    for (const delay of [40, 180, 360]) {
      window.setTimeout(scrollMessagesToBottom, delay);
    }
  }

  const conversationMessages = useMemo(() => messages.filter(isConversationMessage), [messages]);
  const history = detail?.history || null;
  const rawMessageRows = useMemo(() => {
    return conversationMessages.map((message) => ({ type: "message", key: message.id, message, trace: null }));
  }, [conversationMessages]);
  const activeMessageRows = useMemo(() => compactOperationalRows(rawMessageRows), [rawMessageRows]);
  const activeMessageRowsSignature = useMemo(() => messageRowsSignature(activeMessageRows), [activeMessageRows]);
  const virtualRows = useVirtualRows(activeMessageRows, messagesContainerRef, virtualListRef, {
    enabled: activeMessageRows.length > VIRTUAL_MESSAGE_THRESHOLD,
    estimate: VIRTUAL_MESSAGE_ESTIMATE
  });
  const threadId = detail?.thread?.id || "";

  useLayoutEffect(() => {
    if (!threadId) return undefined;
    if (initialLatestScrollRef.current.threadId !== threadId) {
      initialLatestScrollRef.current = { threadId, done: false };
      pinnedToLatestRef.current = true;
    }
    const scrollState = initialLatestScrollRef.current;
    const isInitialOpen = !scrollState.done;
    const userIsScrolling = Date.now() < userScrollHoldUntilRef.current;
    const shouldStickToLatest = (pinnedToLatestRef.current && !userIsScrolling) || isInitialOpen;
    if (!shouldStickToLatest) return undefined;
    if (loading && !activeMessageRows.length) return undefined;

    const scrollToBottom = () => {
      const container = messagesContainerRef.current;
      if (container) container.scrollTop = container.scrollHeight;
      setIsNearBottom(true);
      setHasNewActivity(false);
    };
    scrollToBottom();
    initialLatestScrollRef.current = {
      threadId,
      done: true
    };
    return undefined;
  }, [activeMessageRowsSignature, loading, messagesContainerRef, threadId, virtualRows.totalHeight]);

  useEffect(() => {
    setHasNewActivity(false);
    setIsNearBottom(true);
    autoLoadOlderArmedRef.current = true;
    lastMessageIdRef.current = messages.at(-1)?.id || "";
    pinnedToLatestRef.current = true;
    initialLatestScrollRef.current = { threadId: detail?.thread?.id || "", done: false };
  }, [detail?.thread?.id]);

  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return undefined;
    const updateScrollState = () => {
      const nearBottom = isContainerNearBottom(container);
      setIsNearBottom((current) => (current === nearBottom ? current : nearBottom));
      pinnedToLatestRef.current = nearBottom;
      if (!nearBottom && initialLatestScrollRef.current.threadId === threadId) initialLatestScrollRef.current.done = true;
      if (nearBottom) setHasNewActivity((current) => (current ? false : current));
      if (container.scrollTop > 96) autoLoadOlderArmedRef.current = true;
      if (
        container.scrollTop < 32 &&
        autoLoadOlderArmedRef.current &&
        history?.hasOlder &&
        !loadingOlder &&
        onLoadOlder
      ) {
        autoLoadOlderArmedRef.current = false;
        onLoadOlder();
      }
    };
    const scheduleScrollStateUpdate = () => {
      if (scrollStateFrameRef.current) return;
      scrollStateFrameRef.current = requestAnimationFrame(() => {
        scrollStateFrameRef.current = 0;
        updateScrollState();
      });
    };
    const holdUserScrollIntent = () => {
      userScrollHoldUntilRef.current = Date.now() + 1200;
      scheduleScrollStateUpdate();
    };
    updateScrollState();
    container.addEventListener("scroll", scheduleScrollStateUpdate, { passive: true });
    container.addEventListener("wheel", holdUserScrollIntent, { passive: true });
    container.addEventListener("touchmove", holdUserScrollIntent, { passive: true });
    return () => {
      cancelAnimationFrame(scrollStateFrameRef.current);
      scrollStateFrameRef.current = 0;
      container.removeEventListener("scroll", scheduleScrollStateUpdate);
      container.removeEventListener("wheel", holdUserScrollIntent);
      container.removeEventListener("touchmove", holdUserScrollIntent);
    };
  }, [detail?.thread?.id, history?.hasOlder, loadingOlder, messagesContainerRef, onLoadOlder]);

  useEffect(() => {
    const lastMessageId = messages.at(-1)?.id || "";
    if (!lastMessageId) return;
    if (!lastMessageIdRef.current) {
      lastMessageIdRef.current = lastMessageId;
      return;
    }
    const nearBottomNow = isContainerNearBottom(messagesContainerRef.current);
    const initialScrollActive = initialLatestScrollRef.current.threadId === threadId && !initialLatestScrollRef.current.done;
    const shouldFollowLatest = pinnedToLatestRef.current || initialScrollActive || nearBottomNow;
    setIsNearBottom((current) => (current === shouldFollowLatest ? current : shouldFollowLatest));
    if (shouldFollowLatest) {
      setHasNewActivity((current) => (current ? false : current));
    } else if (lastMessageId !== lastMessageIdRef.current) {
      setHasNewActivity((current) => (current ? current : true));
    }
    lastMessageIdRef.current = lastMessageId;
  }, [messages, messagesContainerRef, threadId]);

  function scrollToLatest() {
    const container = messagesContainerRef.current;
    if (container) container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
    else messagesEndRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
    setIsNearBottom(true);
    setHasNewActivity(false);
    pinnedToLatestRef.current = true;
    userScrollHoldUntilRef.current = 0;
    if (initialLatestScrollRef.current.threadId === threadId) initialLatestScrollRef.current.done = true;
  }

  function renderMessageRow(row) {
    if (row.type === "worklog_bundle") return <WorklogBundle messages={row.messages || []} />;
    return (
      <MessageBlock
        message={row.message}
        trace={row.trace || null}
        onDismissQueueItem={onDismissQueueItem}
        onRetryQueueItem={onRetryQueueItem}
      />
    );
  }

  if (!detail && !loading) {
    return <EmptyState icon={<Bot />} title="先选择一个聊天" body="打开任意聊天后，就可以继续发送消息。" />;
  }
  const runIsBlocking = isBlockingRunState(runState);
  const composerBusy = runIsBlocking;
  const liveStatus = liveStatusLabel({ sending, awaitingReply, runState });
  const showOlderButton = Boolean(history?.hasOlder && onLoadOlder);
  const showJumpToLatest = !isNearBottom;
  const showLiveStatus = Boolean(liveStatus);

  return (
    <div className="thread-detail">
      <ThreadCommandHeader
        detail={detail}
        liveStatus={liveStatus}
        modelInfo={modelInfo}
        onCancel={onCancel}
        onModelChange={onModelChange}
        runIsBlocking={runIsBlocking}
        runState={runState}
      />
      <div className="messages" aria-live="polite" ref={messagesContainerRef}>
        {runState.lastError ? <p className="run-error inline">{humanizeErrorMessage(runState.lastError)}</p> : null}
        {showOlderButton ? (
          <div className="history-window-banner">
            <button className="history-window-button" type="button" onClick={onLoadOlder} disabled={loadingOlder}>
              {loadingOlder ? <Loader2 className="spin" size={14} /> : <ChevronUp size={14} />}
          <span>{loadingOlder ? "正在加载更早消息..." : "更早的消息"}</span>
            </button>
          </div>
        ) : null}
        {loading && !messages.length ? <LoadingRows /> : null}
        {loading && messages.length && isNearBottom ? <div className="sync-inline-banner"><Loader2 className="spin" size={14} /><span>正在同步最新消息...</span></div> : null}
        {!loading && !messages.length ? <EmptyState icon={<Clock3 />} title="还没有消息" body="发第一条消息后，这里会自动同步。" /> : null}
        {!loading && messages.length && !activeMessageRows.length ? <EmptyState icon={<MessageSquare />} title="还没有聊天内容" body="这里暂时没有可显示的消息。" /> : null}
        {activeMessageRows.length ? (
          <div className={"virtual-message-list " + (virtualRows.enabled ? "enabled" : "")} ref={virtualListRef}>
            {virtualRows.beforeHeight ? <div className="virtual-message-spacer" style={{ height: virtualRows.beforeHeight }} /> : null}
            {virtualRows.rows.map(({ item, key }) => (
              <div className="virtual-message-row" key={key} ref={(node) => virtualRows.measure(key, node)}>
                {renderMessageRow(item)}
              </div>
            ))}
            {virtualRows.afterHeight ? <div className="virtual-message-spacer" style={{ height: virtualRows.afterHeight }} /> : null}
          </div>
        ) : null}
        {showJumpToLatest ? <button className="jump-latest-button" type="button" onClick={scrollToLatest}><ChevronDown size={14} /><span>{hasNewActivity ? "有新消息，回到底部" : "回到底部"}</span></button> : null}
        <div className="messages-end" ref={messagesEndRef} />
      </div>

      {showLiveStatus ? <LiveRunStatus label={liveStatus} runState={runState} /> : null}
      <Composer busy={composerBusy} detail={detail} modelInfo={modelInfo} draftText={draftText} onDraftChange={onDraftChange} onFocus={keepComposerVisible} onSend={onSend} onStop={onCancel} />
    </div>
  );
}

function ThreadCommandHeader({ detail, liveStatus, modelInfo, onCancel, onModelChange, runIsBlocking, runState }) {
  const title = compactVisibleValue(cleanThreadTitle(detail?.thread?.title || "选择一个对话"), 78);
  const statusLabel = liveStatus || (runIsBlocking ? runPhaseLabel(runState?.phase || "running") : "");
  return (
    <header className="thread-command-header">
      <div className="thread-command-main">
        <h2>{title}</h2>
      </div>
      <div className="thread-command-controls">
        {statusLabel ? (
          <span className={`thread-command-status ${runIsBlocking ? "busy" : "ready"}`}>
            {runIsBlocking ? <Loader2 className="spin" size={14} /> : <CheckCircle2 size={14} />}
            {statusLabel}
          </span>
        ) : null}
        <ModelSelector modelInfo={modelInfo || {}} onChange={onModelChange} />
        {runIsBlocking ? (
          <button className="stop-run-button" type="button" onClick={onCancel}>
            <Square fill="currentColor" size={13} />
            <span>停止</span>
          </button>
        ) : null}
      </div>
    </header>
  );
}

function CopyActionButton({ value, label = "复制" }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      const success = await copyText(value);
      if (!success) return;
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  }

  return <button className={"inline-action-button " + (copied ? "copied" : "")} type="button" onClick={handleCopy} aria-label={copied ? "已复制" : label}>{copied ? <Check size={14} /> : <Copy size={14} />}</button>;
}

function ExpandableText({ text, className = "", maxLength = 420 }) {
  const [expanded, setExpanded] = useState(false);
  const value = stringifyVisibleValue(text || "");
  const preview = getCollapsiblePreview(value, maxLength);
  const visibleText = expanded || !preview.shouldCollapse ? value : preview.collapsed;
  if (!value) return null;

  return (
    <div className={"expandable-text " + className}>
      <p>{visibleText}</p>
      {preview.shouldCollapse ? <button className="inline-text-toggle" type="button" onClick={() => setExpanded((current) => !current)}>{expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}<span>{expanded ? "收起" : "展开"}</span></button> : null}
    </div>
  );
}

function TracePreview({ trace }) {
  if (!trace) return null;
  return (
    <div className="trace-preview-list">
      <TraceLine message={trace} />
    </div>
  );
}

function LiveRunStatus({ label, runState }) {
  const phase = runPhaseLabel(runState?.phase || "");
  return (
    <article className="live-status-row" aria-label={label}>
      <span className="live-status-icon">
        <Loader2 size={14} />
      </span>
      <span className="live-status-copy">
        <strong>{label}</strong>
        {phase && phase !== "已就绪" ? <em>{phase}</em> : null}
      </span>
      <span className="thinking-dots" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
    </article>
  );
}

function TraceLine({ message }) {
  const isTool = message.kind?.startsWith("tool") || message.role === "tool";
  const isRunState = message.kind === "run_state";
  if (isRunState) return null;
  if (!message.activityLabel && isTool) return null;
  const title = traceTitle(message);
  const status = message.toolStatus || (isRunState ? message.toolName : "finished");
  const failed = stringifyVisibleValue(status) === "failed";
  const detailText = stringifyVisibleValue(message.outputPreview || message.text || "");
  const copyValue = [title, detailText].filter(Boolean).join("\n\n");
  return (
    <article className={"trace-block " + (isRunState ? "run-state" : "")}>
      <div className="trace-row">
        <span className="trace-title">
          {isRunState ? <Clock3 size={15} /> : <Wrench size={15} />}
          {message.activityLabel ? <strong>{message.activityLabel}</strong> : <strong>{title}</strong>}
        </span>
        <span className="trace-actions">
          {failed ? <ToolStatus status={status} /> : null}
          <CopyActionButton value={copyValue || title} label="复制操作" />
        </span>
      </div>
      {detailText ? <ExpandableText className="trace-body" text={detailText} maxLength={320} /> : null}
    </article>
  );
}

function WorklogBundle({ messages = [] }) {
  const [expanded, setExpanded] = useState(false);
  if (!messages.length) return null;
  const latest = messages.at(-1);
  const latestText = compactVisibleValue(latest?.text || "", 120);

  return (
    <article className={"worklog-bundle " + (expanded ? "expanded" : "")}>
      <button className="worklog-toggle" type="button" onClick={() => setExpanded((current) => !current)}>
        {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        <span>{messages.length === 1 ? "1 条过程更新" : `${messages.length} 条过程更新`}</span>
        {!expanded && latestText ? <em>{latestText}</em> : null}
      </button>
      {expanded ? (
        <div className="worklog-items">
          {messages.map((message) => (
            <p key={message.id || `${message.createdAt}:${message.text}`}>{compactVisibleValue(message.text || "", 220)}</p>
          ))}
        </div>
      ) : null}
    </article>
  );
}

function MessageBlock({ message, trace = null, onDismissQueueItem, onRetryQueueItem }) {
  const isTool = message.kind?.startsWith("tool") || message.role === "tool";
  const isRunState = message.kind === "run_state";
  const isUser = message.role === "user";
  const rawText = message.text || message.outputPreview || "";
  const textValue = stringifyVisibleValue(rawText);
  const pendingStage = message.pendingStage || "sending";
  const canDismissQueueItem = Boolean(message.queueId && onDismissQueueItem && (message.pending || message.failed));
  const showQueueHelp = message.pending && ["recovering", "retrying"].includes(pendingStage);
  const messageMaxLength = isUser ? 520 : 340;

  if (isTool || isRunState) {
    return <TraceLine message={message} />;
  }

  return (
    <article className={"message " + (isUser ? "user" : "assistant") + (message.pending ? " pending" : "") + (message.failed ? " failed" : "")}>
      <div className="message-avatar">{isUser ? <Smartphone size={15} /> : <Bot size={17} />}</div>
      <div className="message-bubble">
        <div className="bubble-actions">
          <CopyActionButton value={textValue} label="复制消息" />
        </div>
        <ExpandableText className="message-text" text={textValue} maxLength={messageMaxLength} />
        {!isUser ? <TracePreview trace={trace} /> : null}
        {isUser && message.fileMeta?.length ? (
          <UploadProgressList files={message.fileMeta} progress={message.fileProgress || []} stage={message.pendingStage} />
        ) : null}
        <div className="message-footer">
          <time>{message.failed ? "发送失败" : message.pending ? queueStageLabel(pendingStage) : formatRelative(message.createdAt)}</time>
          {showQueueHelp ? <span className="message-help-text">{queueStageHelp(pendingStage, message.attempts || 0)}</span> : null}
          {message.error ? <span className="message-error-text">{humanizeErrorMessage(message.error)}</span> : null}
          {message.failed && message.queueId && onRetryQueueItem ? (
            <button className="message-retry-button" type="button" onClick={() => onRetryQueueItem(message.queueId)}>
              重试
            </button>
          ) : null}
          {canDismissQueueItem ? (
            <button className="message-dismiss-button" type="button" onClick={() => onDismissQueueItem(message.queueId)}>
              {message.failed ? "关闭" : "停止重试"}
            </button>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function UploadProgressList({ files = [], progress = [], stage = "" }) {
  if (!files.length) return null;
  return (
    <div className="upload-progress-list">
      {files.map((file, index) => {
        const item = progress[index] || {};
        const state = item.state || (stage === "uploading" ? "uploading" : "queued");
        const percent = Math.max(0, Math.min(100, Number(item.percent || 0)));
        const indeterminate = state === "uploading" || state === "retrying";
        const label =
          state === "uploaded"
            ? "已上传"
            : state === "ready"
              ? "等待上传"
              : state === "failed"
                ? "上传失败"
                : state === "retrying"
                  ? "等待重试"
                  : state === "reading"
                    ? `读取中 ${percent}%`
                    : "待发送";
        return (
          <div className={`upload-progress-row ${state}`} key={`${file.name}:${file.size}:${index}`}>
            <Paperclip size={13} />
            <span className="upload-progress-name">{file.name}</span>
            <span className="upload-progress-size">{formatFileSize(file.size || item.total || 0)}</span>
            <span className={`upload-progress-track ${indeterminate ? "indeterminate" : ""}`}>
              <i style={{ width: `${indeterminate ? 45 : percent}%` }} />
            </span>
            <small>{label}</small>
          </div>
        );
      })}
    </div>
  );
}

function traceTitle(message) {
  const toolName = stringifyVisibleValue(message.toolName || "");
  if (toolName) return toolName;
  if (message.kind === "tool_call") return "tool_call";
  if (message.kind === "tool_output") return "tool_output";
  if (message.kind === "run_state") return "run_state";
  return stringifyVisibleValue(message.kind || "trace");
}

function stringifyVisibleValue(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return redactVisibleSecretsText(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(stringifyVisibleValue).filter(Boolean).join("\n");
  if (typeof value === "object") {
    if (typeof value.text === "string") return redactVisibleSecretsText(value.text);
    if (value.text) return stringifyVisibleValue(value.text);
    if (typeof value.completed === "string") return redactVisibleSecretsText(value.completed);
    if (value.completed) return stringifyVisibleValue(value.completed);
    try {
      return redactVisibleSecretsText(JSON.stringify(value, null, 2));
    } catch {
      return redactVisibleSecretsText(String(value));
    }
  }
  return redactVisibleSecretsText(String(value));
}

function redactVisibleSecretsText(value) {
  return String(value || "")
    .replace(/\bapi[-_ ]?key[-_ ]+sk-[A-Za-z0-9_-]{8,}\b/gi, "api-key-[redacted]")
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/gi, "sk-...[redacted]")
    .replace(/\bapi[-_ ]?key\b[:= ]*([A-Za-z0-9_-]{8,})/gi, "api key: [redacted]")
    .replace(/\bBearer\s+[A-Za-z0-9._-]{12,}\b/gi, "Bearer [redacted]");
}

function compactVisibleValue(value, maxLength = 96) {
  const normalized = stringifyVisibleValue(value).replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}...`;
}

function ToolStatus({ status = "finished" }) {
  const statusText = toolStatusLabel(status);
  const failed = statusText === "失败";
  return (
    <span className={`tool-status ${failed ? "failed" : ""}`}>
      {failed ? <AlertCircle size={14} /> : <CheckCircle2 size={14} />}
      {statusText}
    </span>
  );
}

function CameraIcon() {
  return <Camera aria-hidden="true" size={18} />;
}

function MicIcon() {
  return <Mic aria-hidden="true" size={18} />;
}

function Composer({ busy, detail, modelInfo, draftText = "", onDraftChange, onFocus, onSend, onStop }) {
  const [message, setMessage] = useState(draftText);
  const [files, setFiles] = useState([]);
  const [cursorIndex, setCursorIndex] = useState(0);
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);
  const cameraInputRef = useRef(null);
  const optionsMenuRef = useRef(null);
  const trigger = getComposerTrigger(message, cursorIndex);
  const slashSuggestions = buildSlashSuggestions({ busy, onCancel: onStop, onSend, openFilePicker: () => fileInputRef.current?.click() });
  const mentionSuggestions = buildMentionSuggestions({ detail, modelInfo });
  const suggestions = trigger ? filterComposerSuggestions(trigger.kind === "slash" ? slashSuggestions : mentionSuggestions, trigger.query) : [];
  const batchBytes = estimateUploadBatchBytes(files);
  const oversizedFiles = files.filter((file) => Number(file.size || 0) > MAX_UPLOAD_FILE_BYTES);
  const batchTooLarge = batchBytes > MAX_UPLOAD_BATCH_BYTES;
  const uploadBlocked = oversizedFiles.length > 0 || batchTooLarge;
  const canSend = Boolean((message.trim() || files.length) && !uploadBlocked);
  const thread = detail?.thread || {};
  const runtime = thread.runtime || modelInfo.runtime?.thread || modelInfo.runtime?.defaults || {};
  const modelLabel = compactVisibleValue(thread.effectiveModel || thread.model || runtime.model || modelInfo.model || "", 18);
  const reasoningLabel = compactVisibleValue(runtime.reasoningEffort || modelInfo.reasoningEffort || "", 12);
  const accessLabel = compactVisibleValue(runtime.accessMode || modelInfo.accessMode || "", 16);
  const branchLabel = compactVisibleValue(thread.gitBranch || "", 18);
  const composerMetaItems = [
    modelLabel ? { id: "model", label: modelLabel } : null,
    reasoningLabel ? { id: "reasoning", label: reasoningLabel } : null,
    accessLabel ? { id: "access", label: accessLabel } : null,
    branchLabel ? { id: "branch", label: branchLabel } : null
  ].filter(Boolean);

  useEffect(() => {
    setMessage(draftText || "");
  }, [detail?.thread?.id, draftText]);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [message]);

  function closeComposerOptions() {
    optionsMenuRef.current?.removeAttribute("open");
  }

  function updateMessage(nextMessage) {
    setMessage(nextMessage);
    onDraftChange?.(nextMessage);
  }

  function updateCursor(event) {
    setCursorIndex(event.currentTarget.selectionStart ?? event.currentTarget.value.length);
  }

  function sendCurrentMessage() {
    const value = message.trim();
    if (uploadBlocked || (!value && !files.length)) return;
    updateMessage("");
    closeComposerOptions();
    const filesToSend = files;
    setFiles([]);
    onSend(value, filesToSend);
  }

  function removeFile(index) {
    setFiles((current) => current.filter((_, itemIndex) => itemIndex !== index));
  }

  function handleFilesSelected(event) {
    const selectedFiles = Array.from(event.target.files || []);
    if (selectedFiles.length) setFiles((current) => [...current, ...selectedFiles]);
    event.target.value = "";
    closeComposerOptions();
  }

  async function recordVoiceFallback() {
    closeComposerOptions();
    if (!("MediaRecorder" in window) || !navigator.mediaDevices?.getUserMedia) {
      updateMessage(`${message}${message ? "\n" : ""}当前浏览器不能直接录音。可以先用 iPhone 语音备忘录录好，再把音频文件传上来。`);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      const chunks = [];
      recorder.ondataavailable = (event) => {
        if (event.data?.size) chunks.push(event.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
        const file = new File([blob], `voice-${Date.now()}.webm`, { type: blob.type });
        setFiles((current) => [...current, file]);
      };
      recorder.start();
      window.setTimeout(() => {
        if (recorder.state === "recording") recorder.stop();
      }, 10000);
      updateMessage(`${message}${message ? "\n" : ""}正在录音 10 秒，结束后会自动作为附件加入这条对话。`);
    } catch (error) {
      updateMessage(`${message}${message ? "\n" : ""}${humanizeErrorMessage(error?.message || "microphone denied")}`);
    }
  }

  function chooseSuggestion(item) {
    if (item.disabled) return;
    if (item.insertText) {
      const nextMessage = trigger ? applyComposerSuggestion(message, trigger, item.insertText) : item.insertText;
      const nextCursor = trigger ? trigger.start + item.insertText.length : item.insertText.length;
      updateMessage(nextMessage);
      setCursorIndex(nextCursor);
      requestAnimationFrame(() => {
        textareaRef.current?.focus();
        textareaRef.current?.setSelectionRange(nextCursor, nextCursor);
      });
      return;
    }
    updateMessage("");
    setCursorIndex(0);
    item.action?.();
  }

  function submit(event) {
    event.preventDefault();
    sendCurrentMessage();
  }

  function handleKeyDown(event) {
    if (trigger && suggestions.length && event.key === "Tab") {
      event.preventDefault();
      chooseSuggestion(suggestions[0]);
      return;
    }
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent?.isComposing) return;
    event.preventDefault();
    sendCurrentMessage();
  }

  return (
    <form className={"composer " + (busy ? "busy" : "")} onSubmit={submit}>
      {trigger && suggestions.length ? (
        <div className="composer-assist" role="listbox" aria-label={trigger.kind === "slash" ? "快捷指令" : "上下文"}>
          <div className="composer-assist-heading">{trigger.kind === "slash" ? "/ 快捷操作" : "@ 上下文"}</div>
          {suggestions.map((item) => (
            <button className="composer-assist-item" disabled={item.disabled} key={item.id} type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => chooseSuggestion(item)}>
              <strong>{item.label}</strong>
              <span>{item.description}</span>
            </button>
          ))}
        </div>
      ) : null}
      {files.length ? (
        <div className="attachment-strip">
          {files.map((file, index) => (
            <div className={`attachment-card ${Number(file.size || 0) > MAX_UPLOAD_FILE_BYTES ? "blocked" : ""}`} key={file.name + ":" + file.size + ":" + index}>
              <Paperclip size={15} />
              <span>
                <strong>{file.name}</strong>
                <small>{filePreviewLabel(file)} | {formatFileSize(file.size)} | {Number(file.size || 0) > MAX_UPLOAD_FILE_BYTES ? "超过 25 MB" : "等待发送"}</small>
              </span>
              <button type="button" onClick={() => removeFile(index)} aria-label="移除附件">
                <X size={14} />
              </button>
            </div>
          ))}
          {batchTooLarge ? <p className="attachment-warning">附件合计 {formatFileSize(batchBytes)}。一次少传几个文件会更稳。</p> : null}
        </div>
      ) : null}
      <textarea
        aria-label="输入消息"
        autoCapitalize="sentences"
        enterKeyHint="send"
        placeholder="输入消息"
        ref={textareaRef}
        rows={2}
        value={message}
        onChange={(event) => {
          updateMessage(event.target.value);
          updateCursor(event);
        }}
        onClick={updateCursor}
        onFocus={(event) => {
          updateCursor(event);
          onFocus?.();
        }}
        onKeyDown={handleKeyDown}
        onKeyUp={updateCursor}
        onSelect={updateCursor}
      />
      <div className="composer-actions">
        <details className="composer-options-menu" ref={optionsMenuRef}>
          <summary className="attach-button composer-options-trigger" aria-label="更多输入选项">
            <Plus size={19} />
          </summary>
          <div className="composer-options-panel" aria-label="更多输入选项">
            <label className="composer-option-item" aria-label="上传文件">
              <Paperclip size={16} />
              <span>
                <strong>上传文件</strong>
                <small>图片、PDF、Word、日志</small>
              </span>
              <input accept="image/*,.pdf,.doc,.docx,.txt,.md,.csv,.json,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" multiple ref={fileInputRef} type="file" onChange={handleFilesSelected} />
            </label>
            <label className="composer-option-item" aria-label="拍照上传">
              <CameraIcon />
              <span>
                <strong>拍照上传</strong>
                <small>直接调用 iPhone 相机</small>
              </span>
              <input accept="image/*" capture="environment" ref={cameraInputRef} type="file" onChange={handleFilesSelected} />
            </label>
            <button className="composer-option-item" type="button" onClick={recordVoiceFallback}>
              <MicIcon />
              <span>
                <strong>语音附件</strong>
                <small>录一段短音频</small>
              </span>
            </button>
            <div className="composer-runtime-row" aria-label="当前运行环境">
              {composerMetaItems.map((item) => (
                <span className={`composer-runtime-pill ${item.id}`} key={item.id}>{item.label}</span>
              ))}
            </div>
          </div>
        </details>
        <div className="composer-right-actions">
          {busy ? (
            <button className="composer-stop-button" type="button" onClick={onStop} aria-label="停止当前任务">
              <Square fill="currentColor" size={14} />
              <span>停止</span>
            </button>
          ) : null}
          {!busy || canSend ? (
            <button className="send-button" type="submit" disabled={!canSend} aria-label={uploadBlocked ? "附件太大，无法发送" : "发送消息"}>
              <Send size={18} />
            </button>
          ) : null}
        </div>
      </div>
    </form>
  );
}

function EmptyState({ icon, title, body }) {
  return (
    <div className="empty-state">
      <div className="empty-icon">{icon}</div>
      <h3>{title}</h3>
      <p>{body}</p>
    </div>
  );
}

function LoadingRows() {
  return (
    <div className="loading-card">
      <Loader2 className="spin" size={18} />
      <span>正在同步最新消息...</span>
    </div>
  );
}
