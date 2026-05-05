const createdSubagents = new Map();

function nowIso() {
  return new Date().toISOString();
}

function stringValue(value) {
  return String(value || "").trim();
}

function flattenExistingSubagents(thread, parentId = "") {
  const result = [];
  for (const subagent of thread?.subagents || []) {
    result.push({
      id: subagent.id,
      parentThreadId: parentId || thread.id || "",
      title: subagent.title || "Subagent",
      role: subagent.agentRole || subagent.agentNickname || "agent",
      status: subagent.status || "synced",
      lastMessage: subagent.lastMessage || "",
      updatedAt: subagent.updatedAt || "",
      nativeThread: true
    });
    result.push(...flattenExistingSubagents(subagent, subagent.id));
  }
  return result;
}

export function listSubagentsForThread(thread) {
  const parentId = thread?.id || "";
  const manual = Array.from(createdSubagents.values()).filter((item) => item.parentThreadId === parentId);
  return [...flattenExistingSubagents(thread, parentId), ...manual].sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
}

export function createSubagentRecord(parentThreadId, { role = "", goal = "", notes = "" } = {}) {
  const record = {
    id: `subagent:${parentThreadId}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
    parentThreadId,
    title: stringValue(goal).slice(0, 80) || "Subagent task",
    role: stringValue(role).slice(0, 60) || "worker",
    notes: stringValue(notes).slice(0, 600),
    status: "command-queued",
    lastMessage: "Created through the /subagents command panel.",
    updatedAt: nowIso(),
    nativeThread: false,
    commandMode: true
  };
  createdSubagents.set(record.id, record);
  return record;
}

export function buildSubagentCommand(record) {
  return [
    "/subagents",
    `Role: ${record.role}`,
    `Goal: ${record.title}`,
    record.notes ? `Notes: ${record.notes}` : "",
    "",
    "Create or route this as a Codex subagent if the current runtime supports it. If native subagents are not available, treat this as an explicit delegated task request and report the limitation."
  ].filter(Boolean).join("\n");
}

export function updateSubagentStatus(id, patch = {}) {
  const record = createdSubagents.get(id);
  if (!record) return null;
  const next = { ...record, ...patch, updatedAt: nowIso() };
  createdSubagents.set(id, next);
  return next;
}

export function parseSubagentSearch(records = [], query = "") {
  const value = stringValue(query).toLowerCase();
  if (!value) return records;
  return records.filter((record) => [record.title, record.role, record.status, record.lastMessage].join(" ").toLowerCase().includes(value));
}
