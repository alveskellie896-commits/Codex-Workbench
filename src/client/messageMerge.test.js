import { describe, expect, test } from "vitest";
import {
  dedupeThreadMessages,
  latestMessageWindow,
  mergeFetchedMessagesWithLocalDrafts,
  mergeThreadMessagesById,
  shouldStickToLatest
} from "./messageMerge.js";

describe("dedupeThreadMessages", () => {
  test("collapses duplicated assistant messages from realtime and rollout streams", () => {
    const duplicateText = "I am checking the desktop state and will update the phone view when it is ready.";
    const messages = [
      {
        id: "app-server:1",
        threadId: "thread-a",
        role: "assistant",
        kind: "message",
        text: duplicateText,
        createdAt: "2026-04-25T00:01:00.000Z"
      },
      {
        id: "rollout:9",
        threadId: "thread-a",
        role: "assistant",
        kind: "message",
        text: duplicateText,
        createdAt: "2026-04-25T00:01:38.000Z"
      }
    ];

    expect(dedupeThreadMessages(messages, "thread-a").map((message) => message.id)).toEqual(["rollout:9"]);
  });

  test("keeps repeated short user prompts when they are separate turns", () => {
    const messages = [
      { id: "user:1", threadId: "thread-a", role: "user", kind: "message", text: "继续", createdAt: "2026-04-25T00:01:00.000Z" },
      { id: "user:2", threadId: "thread-a", role: "user", kind: "message", text: "继续", createdAt: "2026-04-25T00:02:00.000Z" }
    ];

    expect(dedupeThreadMessages(messages, "thread-a").map((message) => message.id)).toEqual(["user:1", "user:2"]);
  });
});

describe("mergeThreadMessagesById", () => {
  test("merges older or newer server pages without duplicating persisted messages", () => {
    const current = [
      { id: "server:2", threadId: "thread-a", role: "user", kind: "message", text: "middle", createdAt: "2026-04-25T00:02:00.000Z" },
      { id: "server:3", threadId: "thread-a", role: "assistant", kind: "message", text: "latest", createdAt: "2026-04-25T00:03:00.000Z" }
    ];
    const olderPage = [
      { id: "server:1", threadId: "thread-a", role: "assistant", kind: "message", text: "older", createdAt: "2026-04-25T00:01:00.000Z" },
      { id: "server:2", threadId: "thread-a", role: "user", kind: "message", text: "middle", createdAt: "2026-04-25T00:02:00.000Z" }
    ];

    expect(mergeThreadMessagesById(current, olderPage, "thread-a").map((message) => message.id)).toEqual([
      "server:1",
      "server:2",
      "server:3"
    ]);
  });

  test("does not merge messages from a different thread window", () => {
    const current = [{ id: "server:1", threadId: "thread-a", role: "assistant", kind: "message", text: "a", createdAt: "2026-04-25T00:01:00.000Z" }];
    const incoming = [{ id: "server:2", threadId: "thread-b", role: "assistant", kind: "message", text: "b", createdAt: "2026-04-25T00:02:00.000Z" }];

    expect(mergeThreadMessagesById(current, incoming, "thread-a").map((message) => message.id)).toEqual(["server:1"]);
  });
});

describe("mergeFetchedMessagesWithLocalDrafts", () => {
  test("keeps a pending local user message when fetched history has not caught up", () => {
    const fetched = [{ id: "server:1", role: "assistant", kind: "message", text: "Ready", createdAt: "2026-04-25T00:00:00.000Z" }];
    const current = [
      ...fetched,
      {
        id: "local:thread-a:1",
        threadId: "thread-a",
        role: "user",
        kind: "message",
        text: "hello from phone",
        createdAt: "2026-04-25T00:01:00.000Z",
        pending: true
      }
    ];

    expect(mergeFetchedMessagesWithLocalDrafts(fetched, current, "thread-a").map((message) => message.text)).toEqual([
      "Ready",
      "hello from phone"
    ]);
  });

  test("drops the pending local message once fetched history contains the same user text", () => {
    const fetched = [
      { id: "server:1", role: "assistant", kind: "message", text: "Ready", createdAt: "2026-04-25T00:00:00.000Z" },
      { id: "server:2", role: "user", kind: "message", text: "hello from phone", createdAt: "2026-04-25T00:01:04.000Z" }
    ];
    const current = [
      ...fetched.slice(0, 1),
      {
        id: "local:thread-a:1",
        threadId: "thread-a",
        role: "user",
        kind: "message",
        text: "hello from phone",
        createdAt: "2026-04-25T00:01:00.000Z",
        pending: true
      }
    ];

    expect(mergeFetchedMessagesWithLocalDrafts(fetched, current, "thread-a")).toEqual(fetched);
  });

  test("does not carry a pending local message into another thread", () => {
    const fetched = [{ id: "server:1", threadId: "thread-b", role: "assistant", kind: "message", text: "Other", createdAt: "2026-04-25T00:00:00.000Z" }];
    const current = [
      {
        id: "local:thread-a:1",
        threadId: "thread-a",
        role: "user",
        kind: "message",
        text: "wrong thread",
        createdAt: "2026-04-25T00:01:00.000Z",
        pending: true
      }
    ];

    expect(mergeFetchedMessagesWithLocalDrafts(fetched, current, "thread-b")).toEqual(fetched);
  });

  test("deduplicates the same local draft when it appears in state and ref snapshots", () => {
    const fetched = [{ id: "server:1", threadId: "thread-a", role: "assistant", kind: "message", text: "Ready", createdAt: "2026-04-25T00:00:00.000Z" }];
    const draft = {
      id: "local:thread-a:1",
      threadId: "thread-a",
      role: "user",
      kind: "message",
      text: "hello from phone",
      createdAt: "2026-04-25T00:01:00.000Z",
      pending: true
    };

    expect(mergeFetchedMessagesWithLocalDrafts(fetched, [draft, draft], "thread-a").map((message) => message.id)).toEqual([
      "server:1",
      "local:thread-a:1"
    ]);
  });
});

describe("mobile message window helpers", () => {
  test("opens large chats at the latest messages", () => {
    const messages = Array.from({ length: 250 }, (_, index) => ({ id: `m:${index}` }));

    expect(latestMessageWindow(messages, 80)[0].id).toBe("m:170");
    expect(latestMessageWindow(messages, 80).at(-1).id).toBe("m:249");
  });

  test("only auto-sticks to latest when the user is already near the bottom", () => {
    expect(shouldStickToLatest({ distanceFromBottom: 20 })).toBe(true);
    expect(shouldStickToLatest({ distanceFromBottom: 240 })).toBe(false);
    expect(shouldStickToLatest({ distanceFromBottom: 20, userScrolled: true })).toBe(false);
  });
});
