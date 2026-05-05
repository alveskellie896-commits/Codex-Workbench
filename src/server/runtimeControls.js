export const REASONING_EFFORTS = ["low", "medium", "high", "xhigh"];
export const ACCESS_MODES = ["read-only", "on-request", "full-access"];
export const DEFAULT_RUNTIME_CONTROLS = {
  model: "",
  reasoningEffort: "medium",
  accessMode: "on-request",
  planMode: false
};

const ACCESS_MODE_CONFIG = {
  "read-only": {
    label: "Read-only",
    approvalPolicy: "on-request",
    sandboxMode: "read-only",
    sandboxPolicy: { mode: "read-only" },
    warning: "Codex can inspect files but should not write changes."
  },
  "on-request": {
    label: "Ask before risky actions",
    approvalPolicy: "on-request",
    sandboxMode: "workspace-write",
    sandboxPolicy: { mode: "workspace-write" },
    warning: "Codex can edit the project, but risky actions still ask first."
  },
  "full-access": {
    label: "Full access",
    approvalPolicy: "never",
    sandboxMode: "danger-full-access",
    sandboxPolicy: { mode: "danger-full-access" },
    warning: "Only use for a trusted local project. The phone UI requires confirmation before saving this mode."
  }
};

function stringValue(value) {
  return String(value || "").trim();
}

function normalizeBoolean(value) {
  return value === true || value === "true" || value === 1 || value === "1";
}

export function normalizeRuntimeControls(value = {}, fallback = DEFAULT_RUNTIME_CONTROLS) {
  const source = value && typeof value === "object" ? value : {};
  const base = fallback && typeof fallback === "object" ? fallback : DEFAULT_RUNTIME_CONTROLS;
  const reasoningEffort = stringValue(source.reasoningEffort || source.effort || base.reasoningEffort || DEFAULT_RUNTIME_CONTROLS.reasoningEffort).toLowerCase();
  const accessMode = stringValue(source.accessMode || base.accessMode || DEFAULT_RUNTIME_CONTROLS.accessMode).toLowerCase();
  return {
    model: stringValue(source.model || base.model || ""),
    reasoningEffort: REASONING_EFFORTS.includes(reasoningEffort) ? reasoningEffort : DEFAULT_RUNTIME_CONTROLS.reasoningEffort,
    accessMode: ACCESS_MODES.includes(accessMode) ? accessMode : DEFAULT_RUNTIME_CONTROLS.accessMode,
    planMode: source.planMode === undefined ? normalizeBoolean(base.planMode) : normalizeBoolean(source.planMode)
  };
}

export function runtimeCapabilities(sendMode = "desktop") {
  const mode = stringValue(sendMode || "desktop");
  return {
    sendMode: mode,
    controls: {
      model: { supported: true, transport: "all" },
      reasoningEffort: { supported: mode !== "desktop", transport: "app-server/cli", values: REASONING_EFFORTS },
      accessMode: { supported: mode !== "desktop", transport: "app-server/cli", values: ACCESS_MODES },
      planMode: {
        supported: mode !== "desktop",
        transport: "prompt-compatible fallback",
        note: "Codex app-server does not expose a stable public Plan Mode flag here, so Workbench sends an explicit planning instruction when enabled."
      },
      steerActiveRun: {
        supported: false,
        transport: "queued follow-up",
        note: "The current bridge reliably queues follow-ups. It does not claim native mid-run steering unless Codex exposes a stable API."
      }
    }
  };
}

export function accessModeConfig(accessMode) {
  return ACCESS_MODE_CONFIG[accessMode] || ACCESS_MODE_CONFIG[DEFAULT_RUNTIME_CONTROLS.accessMode];
}

export function prefixPromptForPlanMode(prompt, controls) {
  const normalized = normalizeRuntimeControls(controls);
  const text = String(prompt || "");
  if (!normalized.planMode) return text;
  return [
    "Plan Mode is enabled for this turn.",
    "First produce a short plan and wait for user approval if the task is risky or destructive.",
    "Do not present this as native iOS behavior; this is the Workbench web fallback.",
    "",
    text
  ].join("\n");
}

export function buildAppServerTurnOptions(controls = {}) {
  const normalized = normalizeRuntimeControls(controls);
  const access = accessModeConfig(normalized.accessMode);
  return {
    model: normalized.model || null,
    effort: normalized.reasoningEffort,
    approvalPolicy: access.approvalPolicy,
    sandboxPolicy: access.sandboxPolicy,
    planMode: normalized.planMode,
    planModeNative: false,
    accessWarning: access.warning
  };
}

export function buildCodexExecResumeArgs({ threadId, prompt, model, controls = {} }) {
  const normalized = normalizeRuntimeControls({ ...controls, model: controls.model || model || "" });
  const access = accessModeConfig(normalized.accessMode);
  const args = [
    "-c",
    `model_reasoning_effort="${normalized.reasoningEffort}"`,
    "-c",
    `approval_policy="${access.approvalPolicy}"`,
    "-c",
    `sandbox_mode="${access.sandboxMode}"`,
    "exec",
    "resume",
    "--json",
    "--skip-git-repo-check"
  ];
  if (normalized.model) args.push("--model", normalized.model);
  args.push(threadId, prefixPromptForPlanMode(prompt, normalized));
  return args;
}

export function runtimePublicPayload({ defaults = DEFAULT_RUNTIME_CONTROLS, thread = null, sendMode = "desktop" } = {}) {
  return {
    defaults: normalizeRuntimeControls(defaults),
    thread: thread ? normalizeRuntimeControls(thread, defaults) : null,
    capabilities: runtimeCapabilities(sendMode),
    accessModes: ACCESS_MODES.map((value) => ({ value, ...accessModeConfig(value) })),
    reasoningEfforts: REASONING_EFFORTS
  };
}
