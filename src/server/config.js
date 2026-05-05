import os from "node:os";
import path from "node:path";
import fs from "node:fs";

function unquoteEnvValue(value) {
  const trimmed = value.trim();
  const quote = trimmed[0];
  if ((quote === "\"" || quote === "'") && trimmed.endsWith(quote)) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function loadDotEnv(filePath = path.resolve(process.cwd(), ".env")) {
  if (!fs.existsSync(filePath)) return false;
  const raw = fs.readFileSync(filePath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const equalsAt = trimmed.indexOf("=");
    if (equalsAt <= 0) continue;
    const key = trimmed.slice(0, equalsAt).trim();
    if (!key || Object.prototype.hasOwnProperty.call(process.env, key)) continue;
    process.env[key] = unquoteEnvValue(trimmed.slice(equalsAt + 1));
  }
  return true;
}

loadDotEnv();

function expandHome(value) {
  if (!value) return "";
  if (value === "~") return os.homedir();
  if (value.startsWith("~/") || value.startsWith("~\\")) {
    return path.join(os.homedir(), value.slice(2));
  }
  return value;
}

export const CODEX_HOME = expandHome(process.env.CODEX_HOME) || path.join(os.homedir(), ".codex");
export const HOST = process.env.CODEX_REMOTE_HOST || "127.0.0.1";
export const PORT = Number(process.env.CODEX_REMOTE_PORT || 8787);
export const PASSWORD = process.env.CODEX_REMOTE_PASSWORD || "";
export const CODEX_REMOTE_MODEL = process.env.CODEX_REMOTE_MODEL || "gpt-5.4";
export const CODEX_SEND_MODE = process.env.CODEX_SEND_MODE || "desktop";
export const ACCESS_TOKEN_TTL_MS = 1000 * 60 * 30;
export const REFRESH_TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 30;

export function resolveCodexCliCommand() {
  if (process.env.CODEX_CLI_PATH) return expandHome(process.env.CODEX_CLI_PATH);
  if (process.platform === "win32") {
    const vendorExe = path.resolve(
      process.cwd(),
      "node_modules",
      "@openai",
      "codex-win32-x64",
      "vendor",
      "x86_64-pc-windows-msvc",
      "codex",
      "codex.exe"
    );
    if (fs.existsSync(vendorExe)) return vendorExe;
  }
  const localBin = path.resolve(process.cwd(), "node_modules", ".bin", process.platform === "win32" ? "codex.cmd" : "codex");
  if (fs.existsSync(localBin)) return localBin;
  return "codex";
}

export function codexProcessEnv() {
  return { ...process.env, CODEX_HOME };
}

export function codexPath(...parts) {
  return path.join(CODEX_HOME, ...parts);
}

export function isLoopbackHost(host = HOST) {
  return ["127.0.0.1", "localhost", "::1"].includes(host);
}
