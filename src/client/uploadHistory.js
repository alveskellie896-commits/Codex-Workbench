export const RECENT_UPLOADS_STORAGE_KEY = "codex-workbench-recent-uploads";
export const MAX_RECENT_UPLOADS = 12;
export const MAX_UPLOAD_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_UPLOAD_BATCH_BYTES = 30 * 1024 * 1024;

function stringValue(value) {
  return String(value || "");
}

export function formatFileSize(bytes = 0) {
  const value = Number(bytes || 0);
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  const digits = size >= 10 || unitIndex === 0 ? 0 : 1;
  return `${size.toFixed(digits).replace(/\.0$/, "")} ${units[unitIndex]}`;
}

export function estimateUploadBatchBytes(files = []) {
  return files.reduce((total, file) => total + Number(file?.size || 0), 0);
}

export function normalizeUploadRecord(record) {
  if (!record || typeof record !== "object") return null;
  const name = stringValue(record.name || "attachment");
  const size = Math.max(0, Number(record.size || 0));
  const threadId = stringValue(record.threadId || record.thread_id || "");
  return {
    id: stringValue(record.id || record.path || `${threadId}:${name}:${size}:${record.uploadedAt || ""}`),
    threadId,
    name,
    type: stringValue(record.type || "application/octet-stream"),
    size,
    path: stringValue(record.path || ""),
    uploadedAt: stringValue(record.uploadedAt || new Date().toISOString()),
    state: stringValue(record.state || "uploaded"),
    error: stringValue(record.error || "")
  };
}

export function mergeRecentUploads(current = [], uploads = [], now = () => new Date(), threadId = "") {
  const uploadedAt = now().toISOString();
  const incoming = uploads
    .map((upload) => normalizeUploadRecord({ ...upload, threadId: upload.threadId || threadId, uploadedAt }))
    .filter(Boolean);
  const existing = current.map(normalizeUploadRecord).filter(Boolean);
  const seen = new Set();
  const merged = [];
  for (const record of [...incoming, ...existing]) {
    const key = `${record.threadId || "global"}:${record.path || `${record.name}:${record.size}:${record.uploadedAt}`}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push({ ...record, id: key });
    if (merged.length >= MAX_RECENT_UPLOADS) break;
  }
  return merged;
}

export function uploadsForThread(records = [], threadId = "") {
  const targetThreadId = stringValue(threadId);
  return records
    .map(normalizeUploadRecord)
    .filter(Boolean)
    .filter((record) => record.threadId === targetThreadId);
}

export function loadStoredRecentUploads() {
  try {
    const raw = localStorage.getItem(RECENT_UPLOADS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeUploadRecord).filter(Boolean).slice(0, MAX_RECENT_UPLOADS);
  } catch {
    return [];
  }
}

export function storeRecentUploads(records = []) {
  try {
    const normalized = records.map(normalizeUploadRecord).filter(Boolean).slice(0, MAX_RECENT_UPLOADS);
    if (!normalized.length) {
      localStorage.removeItem(RECENT_UPLOADS_STORAGE_KEY);
      return;
    }
    localStorage.setItem(RECENT_UPLOADS_STORAGE_KEY, JSON.stringify(normalized));
  } catch {
    // Upload history is convenience UI; failed storage should not block sending.
  }
}
