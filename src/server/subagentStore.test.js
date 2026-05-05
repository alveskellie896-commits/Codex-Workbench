import { describe, expect, test } from "vitest";
import { buildSubagentCommand, createSubagentRecord, listSubagentsForThread, parseSubagentSearch } from "./subagentStore.js";

describe("subagentStore", () => {
  test("lists native subagent tree with parent links", () => {
    const thread = {
      id: "parent",
      subagents: [
        {
          id: "child",
          title: "Explore API",
          agentRole: "explorer",
          updatedAt: "2026-05-01T00:00:00.000Z",
          subagents: [{ id: "grand", title: "Review tests", agentNickname: "reviewer" }]
        }
      ]
    };

    const rows = listSubagentsForThread(thread);

    expect(rows.map((row) => row.id)).toContain("child");
    expect(rows.find((row) => row.id === "child")).toMatchObject({ parentThreadId: "parent", nativeThread: true });
    expect(rows.find((row) => row.id === "grand")).toMatchObject({ parentThreadId: "child", nativeThread: true });
  });

  test("creates explicit command fallback records", () => {
    const record = createSubagentRecord("parent", { role: "tester", goal: "Check mobile keyboard", notes: "iPhone PWA" });
    const command = buildSubagentCommand(record);

    expect(record.commandMode).toBe(true);
    expect(command).toContain("/subagents");
    expect(command).toContain("Role: tester");
    expect(command).toContain("Goal: Check mobile keyboard");
  });

  test("filters subagent records by role title or status", () => {
    const records = [
      { title: "Docs", role: "docs", status: "queued" },
      { title: "Review", role: "reviewer", status: "done" }
    ];

    expect(parseSubagentSearch(records, "review")).toEqual([records[1]]);
  });
});
