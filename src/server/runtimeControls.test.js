import { describe, expect, test } from "vitest";
import {
  buildAppServerTurnOptions,
  buildCodexExecResumeArgs,
  normalizeRuntimeControls,
  runtimeCapabilities
} from "./runtimeControls.js";

describe("runtimeControls", () => {
  test("normalizes supported reasoning and access values", () => {
    expect(normalizeRuntimeControls({ reasoningEffort: "HIGH", accessMode: "read-only", planMode: "true" })).toMatchObject({
      reasoningEffort: "high",
      accessMode: "read-only",
      planMode: true
    });
    expect(normalizeRuntimeControls({ reasoningEffort: "invalid", accessMode: "root" })).toMatchObject({
      reasoningEffort: "medium",
      accessMode: "on-request"
    });
  });

  test("maps access mode to app-server parameters", () => {
    expect(buildAppServerTurnOptions({ accessMode: "read-only", reasoningEffort: "xhigh" })).toMatchObject({
      approvalPolicy: "on-request",
      sandboxPolicy: { mode: "read-only" },
      effort: "xhigh"
    });
  });

  test("builds Codex CLI resume args with real config overrides", () => {
    const args = buildCodexExecResumeArgs({
      threadId: "thread-a",
      prompt: "hello",
      model: "gpt-5.4",
      controls: { reasoningEffort: "high", accessMode: "on-request" }
    });

    expect(args).toContain("exec");
    expect(args).toContain("resume");
    expect(args).toContain('model_reasoning_effort="high"');
    expect(args).toContain('approval_policy="on-request"');
    expect(args).toContain('sandbox_mode="workspace-write"');
    expect(args).toContain("--model");
  });

  test("desktop mode reports unsupported native steering", () => {
    const capabilities = runtimeCapabilities("desktop");
    expect(capabilities.controls.steerActiveRun.supported).toBe(false);
    expect(capabilities.controls.reasoningEffort.supported).toBe(false);
  });
});
