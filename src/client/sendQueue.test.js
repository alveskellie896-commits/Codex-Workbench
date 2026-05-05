// @vitest-environment jsdom

import { describe, expect, test } from "vitest";
import {
  SEND_QUEUE_STALE_AFTER_MS,
  createSendQueueItem,
  isDesktopDeliveryQueueError,
  isRetryableQueueError,
  loadStoredSendQueue,
  maxQueueAutoRetryAttempts,
  pendingRepliesFromQueue,
  queueBackoffMs,
  queueItemToLocalMessage,
  queueStageHelp,
  queueStageLabel,
  storeSendQueue
} from "./sendQueue.js";

describe("sendQueue", () => {
  test("creates a local queued message before network work starts", () => {
    const item = createSendQueueItem({
      threadId: "thread-1",
      text: "hello",
      files: [{ name: "demo.pdf", type: "application/pdf", size: 12 }]
    });
    const message = queueItemToLocalMessage(item);

    expect(item.stage).toBe("queued");
    expect(message.pending).toBe(true);
    expect(message.text).toContain("hello");
    expect(message.text).toContain("demo.pdf");
    expect(message.fileMeta[0]).toMatchObject({ name: "demo.pdf", size: 12 });
    expect(message.fileProgress[0]).toMatchObject({ state: "queued", percent: 0 });
    expect(queueStageLabel(message.pendingStage)).toBe("待发送");
    expect(queueStageHelp(message.pendingStage)).toContain("手机本地排队");
  });

  test("exposes one active pending reply per thread", () => {
    const first = createSendQueueItem({ threadId: "thread-1", text: "first" });
    const second = createSendQueueItem({ threadId: "thread-1", text: "second" });
    second.createdAt = new Date(Date.now() + 1000).toISOString();

    const replies = pendingRepliesFromQueue([first, second]);
    expect(replies["thread-1"].queueId).toBe(first.id);
    expect(replies["thread-1"].stage).toBe("queued");
  });

  test("treats network and active-run failures as retryable", () => {
    expect(isRetryableQueueError(new Error("Network request failed"))).toBe(true);
    expect(isRetryableQueueError({ statusCode: 409, message: "Thread already has an active run" })).toBe(true);
    expect(isRetryableQueueError({ statusCode: 400, message: "Message is required" })).toBe(false);
  });

  test("caps auto-retry differently for active runs and desktop delivery failures", () => {
    expect(maxQueueAutoRetryAttempts({ statusCode: 409, message: "Thread already has an active run" })).toBe(8);
    expect(maxQueueAutoRetryAttempts(new Error("Did not detect Codex Desktop receiving the message. Keep Codex open and retry."))).toBe(1);
    expect(isDesktopDeliveryQueueError(new Error("Did not detect Codex Desktop receiving the message. Keep Codex open and retry."))).toBe(true);
    expect(isDesktopDeliveryQueueError(new Error("Network request failed"))).toBe(false);
  });

  test("backs off retry attempts without growing forever", () => {
    expect(queueBackoffMs(1)).toBe(1200);
    expect(queueBackoffMs(20)).toBe(30000);
  });

  test("rehydrates in-flight work as recovering before it retries", () => {
    localStorage.clear();
    const item = createSendQueueItem({ threadId: "thread-1", text: "resume me" });
    item.stage = "retrying";
    item.error = "Network request failed";

    storeSendQueue([item]);
    const [reloaded] = loadStoredSendQueue();

    expect(reloaded.stage).toBe("recovering");
    expect(reloaded.error).toBe("");
    expect(queueStageLabel(reloaded.stage)).toBe("正在确认上一条");
  });

  test("rehydrates delivered work as recovering so old Safari state can self-heal", () => {
    localStorage.clear();
    const item = createSendQueueItem({ threadId: "thread-1", text: "already sent" });
    item.stage = "delivered";

    storeSendQueue([item]);
    const [reloaded] = loadStoredSendQueue();

    expect(reloaded.stage).toBe("recovering");
  });

  test("stops stale recovered work instead of showing an old spinner forever", () => {
    localStorage.clear();
    const item = createSendQueueItem({ threadId: "thread-1", text: "too old" });
    item.stage = "submitted";
    item.createdAt = new Date(Date.now() - SEND_QUEUE_STALE_AFTER_MS - 1000).toISOString();
    item.updatedAt = item.createdAt;

    storeSendQueue([item]);
    const [reloaded] = loadStoredSendQueue();

    expect(reloaded.stage).toBe("failed");
    expect(reloaded.error).toContain("已停止自动重试");
    expect(queueItemToLocalMessage(reloaded).pending).toBe(false);
  });
});
