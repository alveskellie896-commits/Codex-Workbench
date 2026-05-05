import { describe, expect, test, vi } from "vitest";
import { RunManager } from "./runManager.js";

describe("RunManager follow-up queue", () => {
  test("creates, edits, reorders, and cancels queued follow-ups", () => {
    const manager = new RunManager({ getThread: vi.fn() });
    const first = manager.enqueueFollowUp("thread-a", "first", { reasoningEffort: "high" });
    const second = manager.enqueueFollowUp("thread-a", "second", { accessMode: "read-only" });

    expect(manager.listFollowUps("thread-a").map((item) => item.prompt)).toEqual(["first", "second"]);

    const edited = manager.updateFollowUp("thread-a", first.id, { prompt: "first edited" });
    expect(edited.prompt).toBe("first edited");

    manager.reorderFollowUp("thread-a", second.id, "up");
    expect(manager.listFollowUps("thread-a").map((item) => item.id)).toEqual([second.id, first.id]);

    const cancelled = manager.cancelFollowUp("thread-a", second.id);
    expect(cancelled.status).toBe("cancelled");
    expect(manager.getState("thread-a").queuedFollowUps).toBe(1);
  });

  test("send while active uses queued follow-up instead of fake steering", async () => {
    const manager = new RunManager({ getThread: vi.fn() });
    manager.states.set("thread-a", { threadId: "thread-a", activeRunId: "run-1", phase: "running", canCancel: true });

    const state = await manager.send("thread-a", "next question", { queueIfRunning: true });

    expect(state.queued).toBe(true);
    expect(state.steerActiveRun).toBe(false);
    expect(state.followUp.prompt).toBe("next question");
  });
});
