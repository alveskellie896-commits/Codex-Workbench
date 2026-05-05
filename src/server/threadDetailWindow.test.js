import { describe, expect, test } from "vitest";
import { normalizeThreadDetailLimit, selectThreadConversationWindow, selectThreadDetailWindow, selectVisibleConversationMessages } from "./threadDetailWindow.js";

function makeMessages(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: `message-${index + 1}`,
    threadId: "thread-1",
    role: index % 2 ? "assistant" : "user",
    kind: "message",
    text: `message ${index + 1}`,
    createdAt: new Date(Date.UTC(2026, 3, 25, 0, 0, index + 1)).toISOString()
  }));
}

describe("normalizeThreadDetailLimit", () => {
  test("falls back for invalid input and clamps oversized input", () => {
    expect(normalizeThreadDetailLimit("")).toBe(160);
    expect(normalizeThreadDetailLimit("hello")).toBe(160);
    expect(normalizeThreadDetailLimit("9999")).toBe(400);
  });
});

describe("selectThreadDetailWindow", () => {
  test("returns the latest page on initial load", () => {
    const payload = selectThreadDetailWindow(makeMessages(8), { limit: 3 });
    expect(payload.incremental).toBe(false);
    expect(payload.hasOlder).toBe(true);
    expect(payload.messages.map((message) => message.id)).toEqual(["message-6", "message-7", "message-8"]);
    expect(payload.totalMessageCount).toBe(8);
    expect(payload.oldestLoadedMessageId).toBe("message-6");
    expect(payload.newestLoadedMessageId).toBe("message-8");
  });

  test("returns newer messages after a known cursor", () => {
    const payload = selectThreadDetailWindow(makeMessages(8), { afterMessageId: "message-6", limit: 3 });
    expect(payload.incremental).toBe(true);
    expect(payload.hasOlder).toBe(true);
    expect(payload.hasNewer).toBe(false);
    expect(payload.messages.map((message) => message.id)).toEqual(["message-7", "message-8"]);
  });

  test("returns older messages before a known cursor", () => {
    const payload = selectThreadDetailWindow(makeMessages(8), { beforeMessageId: "message-7", limit: 3 });
    expect(payload.incremental).toBe(false);
    expect(payload.hasOlder).toBe(true);
    expect(payload.hasNewer).toBe(true);
    expect(payload.messages.map((message) => message.id)).toEqual(["message-4", "message-5", "message-6"]);
  });

  test("resyncs to the latest page when the incremental cursor is missing", () => {
    const payload = selectThreadDetailWindow(makeMessages(8), { afterMessageId: "missing", limit: 2 });
    expect(payload.incremental).toBe(false);
    expect(payload.messages.map((message) => message.id)).toEqual(["message-7", "message-8"]);
  });

  test("returns an empty page when there is nothing older to load", () => {
    const payload = selectThreadDetailWindow(makeMessages(4), { beforeMessageId: "message-1", limit: 3 });
    expect(payload.incremental).toBe(false);
    expect(payload.hasOlder).toBe(false);
    expect(payload.messages).toEqual([]);
  });
});

describe("selectThreadConversationWindow", () => {
  test("windows by visible chat messages instead of hidden tool activity", () => {
    const messages = [
      { id: "m-1", threadId: "thread-1", role: "user", kind: "message", text: "first", createdAt: "2026-04-25T00:00:01.000Z" },
      { id: "tool-1", threadId: "thread-1", role: "tool", kind: "tool_call", text: "hidden", createdAt: "2026-04-25T00:00:02.000Z" },
      { id: "state-1", threadId: "thread-1", role: "system", kind: "run_state", outputPreview: "hidden", createdAt: "2026-04-25T00:00:03.000Z" },
      { id: "m-2", threadId: "thread-1", role: "assistant", kind: "message", text: "second", createdAt: "2026-04-25T00:00:04.000Z" },
      { id: "tool-2", threadId: "thread-1", role: "tool", kind: "tool_output", outputPreview: "hidden", createdAt: "2026-04-25T00:00:05.000Z" },
      { id: "m-3", threadId: "thread-1", role: "user", kind: "message", text: "third", createdAt: "2026-04-25T00:00:06.000Z" }
    ];

    expect(selectVisibleConversationMessages(messages).map((message) => message.id)).toEqual(["m-1", "m-2", "m-3"]);
    const payload = selectThreadConversationWindow(messages, { limit: 2 });
    expect(payload.totalMessageCount).toBe(3);
    expect(payload.messages.map((message) => message.id)).toEqual(["m-2", "m-3"]);
    expect(payload.hasOlder).toBe(true);
  });
});
