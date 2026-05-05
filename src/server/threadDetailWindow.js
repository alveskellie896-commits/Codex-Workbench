export const DEFAULT_THREAD_DETAIL_LIMIT = 160;
export const MAX_THREAD_DETAIL_LIMIT = 400;

export function normalizeThreadDetailLimit(value, fallback = DEFAULT_THREAD_DETAIL_LIMIT) {
  const parsed = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.max(parsed, 1), MAX_THREAD_DETAIL_LIMIT);
}

export function isConversationDetailMessage(message) {
  return Boolean(message && message.kind === "message" && (message.role === "user" || message.role === "assistant"));
}

export function selectVisibleConversationMessages(messages) {
  return (Array.isArray(messages) ? messages : []).filter(isConversationDetailMessage);
}

function firstMessageId(messages) {
  return messages.find((message) => message?.id)?.id || "";
}

function lastMessageId(messages) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.id) return messages[index].id;
  }
  return "";
}

function windowPayload(allMessages, windowMessages, options = {}) {
  return {
    messages: windowMessages,
    incremental: Boolean(options.incremental),
    pageLimit: options.pageLimit,
    totalMessageCount: allMessages.length,
    hasOlder: Boolean(options.hasOlder),
    hasNewer: Boolean(options.hasNewer),
    oldestLoadedMessageId: firstMessageId(windowMessages),
    newestLoadedMessageId: lastMessageId(windowMessages)
  };
}

export function selectThreadDetailWindow(messages, options = {}) {
  const allMessages = Array.isArray(messages) ? messages : [];
  const afterMessageId = options.afterMessageId || "";
  const beforeMessageId = options.beforeMessageId || "";
  const pageLimit = normalizeThreadDetailLimit(options.limit);

  if (beforeMessageId) {
    const beforeIndex = allMessages.findIndex((message) => message?.id === beforeMessageId);
    if (beforeIndex <= 0) {
      return windowPayload(allMessages, [], {
        pageLimit,
        incremental: false,
        hasOlder: false,
        hasNewer: Boolean(allMessages.length)
      });
    }
    const startIndex = Math.max(0, beforeIndex - pageLimit);
    return windowPayload(allMessages, allMessages.slice(startIndex, beforeIndex), {
      pageLimit,
      incremental: false,
      hasOlder: startIndex > 0,
      hasNewer: true
    });
  }

  if (afterMessageId) {
    const afterIndex = allMessages.findIndex((message) => message?.id === afterMessageId);
    if (afterIndex >= 0) {
      return windowPayload(allMessages, allMessages.slice(afterIndex + 1), {
        pageLimit,
        incremental: true,
        hasOlder: afterIndex >= 0,
        hasNewer: false
      });
    }
  }

  const startIndex = Math.max(0, allMessages.length - pageLimit);
  return windowPayload(allMessages, allMessages.slice(startIndex), {
    pageLimit,
    incremental: false,
    hasOlder: startIndex > 0,
    hasNewer: false
  });
}

export function selectThreadConversationWindow(messages, options = {}) {
  return selectThreadDetailWindow(selectVisibleConversationMessages(messages), options);
}
