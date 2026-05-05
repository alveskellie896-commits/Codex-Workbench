function messageText(message) {
  return message?.text || message?.outputPreview || "";
}

function normalizedMessageText(message) {
  return messageText(message).replace(/\s+/g, " ").trim();
}

function localUserKey(message) {
  return `${message.role || ""}:${message.kind || ""}:${messageText(message)}`;
}

function createdAtValue(message) {
  const value = new Date(message?.createdAt || 0).getTime();
  return Number.isFinite(value) ? value : 0;
}

function belongsToThread(message, threadId) {
  if (!threadId) return true;
  return !message?.threadId || message.threadId === threadId;
}

function contentDuplicateKey(message, threadId) {
  const text = normalizedMessageText(message);
  if (!text) return "";
  if (!["message", "run_state"].includes(message?.kind || "")) return "";
  return [message?.threadId || threadId || "", message?.role || "", message?.kind || "", text].join("\u0001");
}

function duplicateWindowMs(message, text) {
  if (message?.role === "user") return text.length >= 12 ? 8000 : 2500;
  if (message?.role === "assistant") return text.length >= 24 ? 15 * 60 * 1000 : 120000;
  return 5000;
}

function shouldCollapseContentDuplicate(previous, next, threadId) {
  const text = normalizedMessageText(next);
  if (!text) return false;
  if (contentDuplicateKey(previous, threadId) !== contentDuplicateKey(next, threadId)) return false;
  const previousAt = createdAtValue(previous);
  const nextAt = createdAtValue(next);
  if (!previousAt || !nextAt) return true;
  return Math.abs(nextAt - previousAt) <= duplicateWindowMs(next, text);
}

function preferDuplicateMessage(previous, next) {
  const previousLocal = previous?.id?.startsWith("local:");
  const nextLocal = next?.id?.startsWith("local:");
  if (previousLocal && !nextLocal) return next;
  if (!previousLocal && nextLocal) return previous;
  return createdAtValue(next) >= createdAtValue(previous) ? next : previous;
}

export function dedupeThreadMessages(messages, threadId = null) {
  const sorted = (Array.isArray(messages) ? messages : [])
    .filter((message) => message && belongsToThread(message, threadId))
    .sort((a, b) => createdAtValue(a) - createdAtValue(b));
  const byId = new Set();
  const byContent = new Map();
  const output = [];

  for (const message of sorted) {
    if (message.id && byId.has(message.id)) continue;
    if (message.id) byId.add(message.id);
    const key = contentDuplicateKey(message, threadId);
    const existing = key ? byContent.get(key) : null;
    if (existing && shouldCollapseContentDuplicate(existing.message, message, threadId)) {
      const preferred = preferDuplicateMessage(existing.message, message);
      output[existing.index] = preferred;
      byContent.set(key, { index: existing.index, message: preferred });
      continue;
    }
    const index = output.length;
    output.push(message);
    if (key) byContent.set(key, { index, message });
  }

  return output.sort((a, b) => createdAtValue(a) - createdAtValue(b));
}

export function mergeThreadMessagesById(currentMessages, incomingMessages, threadId) {
  const baseMessages = (Array.isArray(currentMessages) ? currentMessages : []).filter(
    (message) => belongsToThread(message, threadId) && !message?.id?.startsWith("local:")
  );
  const nextMessages = (Array.isArray(incomingMessages) ? incomingMessages : []).filter((message) =>
    belongsToThread(message, threadId)
  );
  const seenIds = new Set(baseMessages.map((message) => message.id).filter(Boolean));
  const merged = [...baseMessages];
  for (const message of nextMessages) {
    if (!message) continue;
    if (message.id && seenIds.has(message.id)) continue;
    if (message.id) seenIds.add(message.id);
    merged.push(message);
  }
  return dedupeThreadMessages(merged, threadId);
}

export function mergeFetchedMessagesWithLocalDrafts(fetchedMessages, currentMessages, threadId = null) {
  const fetched = Array.isArray(fetchedMessages) ? fetchedMessages : [];
  const fetchedKeys = new Set(fetched.map(localUserKey));
  const targetThreadId = threadId || fetched.find((message) => message?.threadId)?.threadId || null;
  const seenLocalDrafts = new Set();
  const localDrafts = (Array.isArray(currentMessages) ? currentMessages : []).filter((message) => {
    if (!message?.id?.startsWith("local:")) return false;
    if (targetThreadId && message.threadId !== targetThreadId) return false;
    if (!message.pending && !message.failed) return false;
    const draftKey = message.id || localUserKey(message);
    if (seenLocalDrafts.has(draftKey)) return false;
    seenLocalDrafts.add(draftKey);
    return !fetchedKeys.has(localUserKey(message));
  });

  return dedupeThreadMessages([...fetched, ...localDrafts], targetThreadId);
}

export function latestMessageWindow(messages, limit = 160) {
  const allMessages = Array.isArray(messages) ? messages : [];
  const pageLimit = Math.max(1, Number(limit || 160));
  return allMessages.slice(Math.max(0, allMessages.length - pageLimit));
}

export function shouldStickToLatest({ distanceFromBottom = 0, userScrolled = false, threshold = 96 } = {}) {
  if (userScrolled) return false;
  return Number(distanceFromBottom || 0) <= Number(threshold || 96);
}
