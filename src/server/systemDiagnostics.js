import fs from "node:fs/promises";
import path from "node:path";

export function makeDiagnosticCheck({ id, label, status = "ok", detail = "", action = "", meta = {} }) {
  const normalizedStatus = ["ok", "warning", "error"].includes(status) ? status : "warning";
  return {
    id,
    label,
    status: normalizedStatus,
    detail,
    action,
    meta
  };
}

export function summarizeDiagnosticChecks(checks = []) {
  const normalizedChecks = checks.map((check) => makeDiagnosticCheck(check));
  const errors = normalizedChecks.filter((check) => check.status === "error").length;
  const warnings = normalizedChecks.filter((check) => check.status === "warning").length;
  const overall = errors ? "error" : warnings ? "warning" : "ok";
  return {
    overall,
    label: overall === "ok" ? "全部正常" : overall === "warning" ? "有风险" : "需要处理",
    errors,
    warnings,
    ok: normalizedChecks.length - errors - warnings
  };
}

export function parseCurrentPhoneLink(raw = "") {
  const result = {
    phoneUrl: "",
    localUrl: "",
    updatedAt: "",
    tunnelType: "",
    stable: false,
    failureReason: "",
    tunnelPasswordIp: ""
  };

  for (const line of String(raw || "").split(/\r?\n/)) {
    const match = line.match(/^([^:]+):\s*(.+)$/);
    if (!match) continue;
    const key = match[1].trim().toLowerCase();
    const value = match[2].trim();
    if (key === "phone") result.phoneUrl = value;
    if (key === "computer") result.localUrl = value;
    if (key === "updatedat") result.updatedAt = value;
    if (key === "tunneltype") result.tunnelType = value;
    if (key === "stable") result.stable = value.toLowerCase() === "true";
    if (key === "failurereason") result.failureReason = value;
    if (key === "tunnelpasswordip") result.tunnelPasswordIp = value;
  }

  return result;
}

export async function readCurrentPhoneLink(filePath = path.join(process.cwd(), "current-phone-link.txt")) {
  try {
    const [raw, stat] = await Promise.all([fs.readFile(filePath, "utf8"), fs.stat(filePath)]);
    return {
      ...parseCurrentPhoneLink(raw),
      path: filePath,
      readable: true,
      fileUpdatedAt: new Date(stat.mtimeMs).toISOString()
    };
  } catch (error) {
    return {
      phoneUrl: "",
      localUrl: "",
      updatedAt: "",
      tunnelType: "",
      stable: false,
      failureReason: "",
      tunnelPasswordIp: "",
      path: filePath,
      readable: false,
      error: error?.message || "Unable to read current-phone-link.txt"
    };
  }
}
