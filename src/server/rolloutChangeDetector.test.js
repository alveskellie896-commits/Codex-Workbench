import { describe, expect, test } from "vitest";
import { detectRolloutChanges } from "./rolloutChangeDetector.js";

describe("detectRolloutChanges", () => {
  test("reports changed rollout files after the initial snapshot", () => {
    const previous = new Map([
      ["/tmp/a.jsonl", 10],
      ["/tmp/b.jsonl", 20]
    ]);
    const threads = [
      { id: "thread-a", cwd: "/project/a", rolloutPath: "/tmp/a.jsonl" },
      { id: "thread-b", cwd: "/project/b", rolloutPath: "/tmp/b.jsonl" }
    ];
    const mtimes = new Map([
      ["/tmp/a.jsonl", 11],
      ["/tmp/b.jsonl", 20]
    ]);

    expect(detectRolloutChanges(previous, threads, mtimes)).toEqual({
      next: new Map([
        ["/tmp/a.jsonl", 11],
        ["/tmp/b.jsonl", 20]
      ]),
      changed: [{ threadId: "thread-a", cwd: "/project/a", rolloutPath: "/tmp/a.jsonl" }]
    });
  });

  test("does not report the first snapshot as a user-visible change", () => {
    const threads = [{ id: "thread-a", cwd: "/project/a", rolloutPath: "/tmp/a.jsonl" }];
    const mtimes = new Map([["/tmp/a.jsonl", 10]]);

    expect(detectRolloutChanges(new Map(), threads, mtimes).changed).toEqual([]);
  });

  test("walks nested subagent threads", () => {
    const previous = new Map([
      ["/tmp/root.jsonl", 10],
      ["/tmp/sub.jsonl", 20]
    ]);
    const threads = [
      {
        id: "thread-root",
        cwd: "/project/a",
        rolloutPath: "/tmp/root.jsonl",
        subagents: [{ id: "thread-sub", cwd: "/project/a", rolloutPath: "/tmp/sub.jsonl", subagents: [] }]
      }
    ];
    const mtimes = new Map([
      ["/tmp/root.jsonl", 10],
      ["/tmp/sub.jsonl", 21]
    ]);

    expect(detectRolloutChanges(previous, threads, mtimes)).toEqual({
      next: new Map([
        ["/tmp/root.jsonl", 10],
        ["/tmp/sub.jsonl", 21]
      ]),
      changed: [{ threadId: "thread-sub", cwd: "/project/a", rolloutPath: "/tmp/sub.jsonl" }]
    });
  });
});
