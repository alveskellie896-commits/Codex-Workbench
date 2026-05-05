import { spawn } from "node:child_process";
import dns from "node:dns/promises";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { Tunnel } from "cloudflared";

loadDotEnvForPublicTunnel();

const DEFAULT_START_PORT = 8787;
const TUNNEL_PROVIDER = process.env.CODEX_PUBLIC_TUNNEL || "auto";
const LOCALHOST_RUN_HOST = process.env.CODEX_LOCALHOST_RUN_HOST || "localhost.run";
const CURRENT_PUBLIC_LINK_FILE = "current-phone-link.txt";
const PUBLIC_URL_READY_TIMEOUT_MS = 45000;
const PUBLIC_URL_PROBE_INTERVAL_MS = 1500;
const PUBLIC_URL_FETCH_TIMEOUT_MS = 5000;
const TUNNEL_HEALTHCHECK_INTERVAL_MS = 15000;
const TUNNEL_FAILURE_THRESHOLD = 2;
const TUNNEL_RESTART_DELAY_MS = 2000;
const CLOUDFLARE_RETRY_LIMIT = 3;
const CLOUDFLARE_URL_PATTERN = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;
const TAILSCALE_URL_PATTERN = /https:\/\/[a-z0-9.-]+\.ts\.net(?:\/[^\s]*)?/i;
const TAILSCALE_HTTPS_PORT = Number(process.env.CODEX_TAILSCALE_HTTPS_PORT || 443);

function unquoteEnvValue(value) {
  const trimmed = value.trim();
  const quote = trimmed[0];
  if ((quote === "\"" || quote === "'") && trimmed.endsWith(quote)) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function loadDotEnvForPublicTunnel(filePath = path.resolve(process.cwd(), ".env")) {
  try {
    if (!fsSync.existsSync(filePath)) return;
    const raw = fsSync.readFileSync(filePath, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const equalsAt = trimmed.indexOf("=");
      if (equalsAt <= 0) continue;
      const key = trimmed.slice(0, equalsAt).trim();
      if (!key || Object.prototype.hasOwnProperty.call(process.env, key)) continue;
      process.env[key] = unquoteEnvValue(trimmed.slice(equalsAt + 1));
    }
  } catch {}
}

function parsePort(value, fallback) {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : fallback;
}

function checkPort(port, host = "127.0.0.1") {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, host);
  });
}

async function findOpenPort(startPort) {
  for (let port = startPort; port < startPort + 100; port += 1) {
    if (await checkPort(port)) return port;
  }
  throw new Error(`No open port found from ${startPort} to ${startPort + 99}`);
}

function waitForPort(port, host = "127.0.0.1", timeoutMs = 10000) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const tryConnect = () => {
      const socket = net.connect({ host, port });
      socket.once("connect", () => {
        socket.destroy();
        resolve();
      });
      socket.once("error", () => {
        socket.destroy();
        if (Date.now() - startedAt > timeoutMs) {
          reject(new Error(`Timed out waiting for local server on ${host}:${port}`));
          return;
        }
        setTimeout(tryConnect, 150);
      });
    };
    tryConnect();
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fileExists(path) {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

function printBanner({ localUrl, publicUrl, tunnelPasswordIp }) {
  console.log("");
  console.log("============================================================");
  console.log("Codex Workbench public link is ready.");
  console.log("");
  console.log(`Computer: ${localUrl}`);
  console.log(`Phone:    ${publicUrl}`);
  if (tunnelPasswordIp) {
    console.log(`Tunnel IP: ${tunnelPasswordIp}`);
  }
  console.log("");
  console.log("Keep this PowerShell window open while using it on your phone.");
  console.log("Do not share the public link with people you do not trust.");
  console.log("Press Ctrl+C to stop.");
  console.log("============================================================");
  console.log("");
}

function tunnelTypeFromUrl(publicUrl = "") {
  const url = String(publicUrl || "").toLowerCase();
  if (url.includes(".ts.net")) return "tailscale";
  if (url.includes("trycloudflare.com")) return "cloudflare";
  if (url.includes("localhost.run")) return "localhost.run";
  return publicUrl ? "custom" : "none";
}

async function writeCurrentPublicLink({ localUrl, publicUrl, tunnelType = "", stable = false, failureReason = "", tunnelPasswordIp = "" }) {
  const target = path.join(process.cwd(), CURRENT_PUBLIC_LINK_FILE);
  const content = [
    `Phone: ${publicUrl || ""}`,
    `Computer: ${localUrl || ""}`,
    `UpdatedAt: ${new Date().toISOString()}`,
    `TunnelType: ${tunnelType || tunnelTypeFromUrl(publicUrl)}`,
    `Stable: ${Boolean(stable)}`,
    `FailureReason: ${failureReason || ""}`,
    tunnelPasswordIp ? `TunnelPasswordIp: ${tunnelPasswordIp}` : ""
  ].filter(Boolean).join("\n");
  await fs.writeFile(target, `${content}\n`, "utf8");
}

function createIdlePromise() {
  return new Promise(() => {});
}

function createChildExitPromise(child, label) {
  return new Promise((resolve) => {
    child.once("exit", (code, signal) => {
      resolve(new Error(`${label} exited: ${code ?? signal ?? "unknown"}`));
    });
    child.once("error", (error) => {
      resolve(error);
    });
  });
}

function waitForCloudflareUrl(tunnel, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out waiting for Cloudflare tunnel URL"));
    }, timeoutMs);
    const cleanup = () => {
      clearTimeout(timeout);
      tunnel.off("url", onUrl);
      tunnel.off("error", onError);
      tunnel.off("exit", onExit);
    };
    const onUrl = (url) => {
      cleanup();
      resolve(url);
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const onExit = (code, signal) => {
      cleanup();
      reject(new Error(`Cloudflare tunnel exited before it was ready: ${code ?? signal ?? "unknown"}`));
    };
    tunnel.once("url", onUrl);
    tunnel.once("error", onError);
    tunnel.once("exit", onExit);
  });
}

async function probePublicUrl(url) {
  const endpoint = new URL("/api/auth/status", url);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PUBLIC_URL_FETCH_TIMEOUT_MS);
  try {
    await dns.lookup(endpoint.hostname);
    const response = await fetch(endpoint, {
      headers: { Accept: "application/json" },
      signal: controller.signal
    });
    if (!response.ok) return false;
    const payload = await response.json().catch(() => null);
    return Boolean(payload && typeof payload.configured === "boolean");
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function waitForPublicUrl(url, timeoutMs = PUBLIC_URL_READY_TIMEOUT_MS) {
  const startedAt = Date.now();
  while (Date.now() - startedAt <= timeoutMs) {
    if (await probePublicUrl(url)) return;
    await sleep(PUBLIC_URL_PROBE_INTERVAL_MS);
  }
  throw new Error(`Public tunnel URL did not become reachable in time: ${url}`);
}

async function findSystemCloudflaredExecutable() {
  const candidates = [
    process.env.CODEX_CLOUDFLARED_PATH,
    process.env.ProgramFiles ? `${process.env.ProgramFiles}\\cloudflared\\cloudflared.exe` : "",
    process.env["ProgramFiles(x86)"] ? `${process.env["ProgramFiles(x86)"]}\\cloudflared\\cloudflared.exe` : ""
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (await fileExists(candidate)) return candidate;
  }
  return null;
}

async function findTailscaleExecutable() {
  const candidates = [
    process.env.CODEX_TAILSCALE_PATH,
    process.env.ProgramFiles ? `${process.env.ProgramFiles}\\Tailscale\\tailscale.exe` : "",
    process.env["ProgramFiles(x86)"] ? `${process.env["ProgramFiles(x86)"]}\\Tailscale\\tailscale.exe` : ""
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (await fileExists(candidate)) return candidate;
  }
  return null;
}

async function findSshExecutable() {
  const candidates = [
    process.env.CODEX_SSH_PATH,
    process.env.WINDIR ? `${process.env.WINDIR}\\System32\\OpenSSH\\ssh.exe` : "",
    "C:\\Windows\\System32\\OpenSSH\\ssh.exe"
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (await fileExists(candidate)) return candidate;
  }
  return null;
}

function runCommand(executable, args, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`Command timed out: ${executable} ${args.join(" ")}`));
    }, timeoutMs);

    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk || "");
    });
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk || "");
    });
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve({ stdout, stderr, code, signal });
        return;
      }
      const detail = (stderr || stdout || "").trim();
      reject(new Error(detail || `Command failed: ${executable} ${args.join(" ")} (${code ?? signal ?? "unknown"})`));
    });
  });
}

function waitForCloudflaredProcessUrl(child, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    let buffered = "";
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out waiting for Cloudflare process tunnel URL"));
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timeout);
      child.stdout?.off("data", onData);
      child.stderr?.off("data", onData);
      child.off("error", onError);
      child.off("exit", onExit);
    };

    const onData = (chunk) => {
      buffered += String(chunk || "");
      const match = buffered.match(CLOUDFLARE_URL_PATTERN);
      if (!match) return;
      cleanup();
      resolve(match[0]);
    };

    const onError = (error) => {
      cleanup();
      reject(error);
    };

    const onExit = (code, signal) => {
      cleanup();
      reject(new Error(`Cloudflare process exited before it was ready: ${code ?? signal ?? "unknown"}`));
    };

    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.once("error", onError);
    child.once("exit", onExit);
  });
}

function walkForStringMatches(value, pattern, matches = []) {
  if (!value) return matches;
  if (typeof value === "string") {
    const found = value.match(pattern);
    if (found) matches.push(found[0]);
    return matches;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => walkForStringMatches(item, pattern, matches));
    return matches;
  }
  if (typeof value === "object") {
    Object.values(value).forEach((item) => walkForStringMatches(item, pattern, matches));
  }
  return matches;
}

function normalizeTailscaleDnsName(value) {
  const hostname = String(value || "").trim().replace(/\.$/, "");
  return hostname && hostname.includes(".ts.net") ? hostname : "";
}

function extractTailscaleUrl(status, commandOutput = "") {
  const outputMatches = walkForStringMatches(commandOutput, TAILSCALE_URL_PATTERN);
  if (outputMatches.length > 0) return outputMatches[0];

  const statusMatches = walkForStringMatches(status, TAILSCALE_URL_PATTERN);
  if (statusMatches.length > 0) return statusMatches[0];

  const dnsName = normalizeTailscaleDnsName(status?.Self?.DNSName || status?.Self?.DNSNameBase || status?.CurrentTailnet?.MagicDNSSuffix);
  if (dnsName) return `https://${dnsName}`;

  const serviceName = normalizeTailscaleDnsName(status?.Self?.HostName);
  const suffix = normalizeTailscaleDnsName(status?.CurrentTailnet?.MagicDNSSuffix);
  if (serviceName && suffix) return `https://${serviceName}.${suffix}`;

  return "";
}

async function getTailscaleStatus(executable) {
  const result = await runCommand(executable, ["status", "--json"], 30000);
  const parsed = JSON.parse(result.stdout || "{}");
  return {
    raw: parsed,
    output: `${result.stdout}\n${result.stderr}`.trim()
  };
}

async function createTailscaleTunnel(port) {
  const executable = await findTailscaleExecutable();
  if (!executable) throw new Error("Tailscale is not installed");

  const before = await getTailscaleStatus(executable);
  if (before.raw?.BackendState === "NeedsLogin") {
    throw new Error(`Tailscale needs login: ${before.raw?.AuthURL || "open Tailscale and sign in"}`);
  }

  await runCommand(executable, ["up", "--reset", "--accept-dns=false", "--unattended"], 120000);
  const target = `http://127.0.0.1:${port}`;
  const command = ["funnel", "--bg", "--yes", `--https=${TAILSCALE_HTTPS_PORT}`, target];
  const configured = await runCommand(executable, command, 120000);
  const status = await getTailscaleStatus(executable);
  const publicUrl = extractTailscaleUrl(status.raw, `${configured.stdout}\n${configured.stderr}\n${status.output}`);

  if (!publicUrl) {
    throw new Error("Tailscale is configured, but the public URL could not be determined");
  }

  await waitForPublicUrl(publicUrl, 120000);
  return {
    url: publicUrl,
    tunnelType: "tailscale",
    stable: true,
    stop: () => {},
    closed: createIdlePromise()
  };
}

async function createSystemCloudflareTunnel(localUrl, executable) {
  const child = spawn(executable, ["tunnel", "--url", localUrl, "--no-autoupdate"], {
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"]
  });
  try {
    const url = await waitForCloudflaredProcessUrl(child);
    await waitForPublicUrl(url);
    return {
      url,
      tunnelType: "cloudflare",
      stable: false,
      stop: () => child.kill(),
      closed: createChildExitPromise(child, "System cloudflared tunnel")
    };
  } catch (error) {
    child.kill();
    throw error;
  }
}

function extractLocalhostRunUrl(buffered) {
  const lines = buffered.split(/\r?\n/);
  for (const line of lines) {
    if (!line.includes("tunneled")) continue;
    const match = line.match(/https:\/\/[a-z0-9.-]+/i);
    if (match) return match[0];
  }
  return null;
}

function waitForLocalhostRunUrl(child, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    let buffered = "";
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out waiting for localhost.run tunnel URL"));
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timeout);
      child.stdout?.off("data", onData);
      child.stderr?.off("data", onData);
      child.off("error", onError);
      child.off("exit", onExit);
    };

    const onData = (chunk) => {
      buffered += String(chunk || "");
      const url = extractLocalhostRunUrl(buffered);
      if (!url) return;
      cleanup();
      resolve(url);
    };

    const onError = (error) => {
      cleanup();
      reject(error);
    };

    const onExit = (code, signal) => {
      cleanup();
      reject(new Error(`localhost.run exited before it was ready: ${code ?? signal ?? "unknown"}`));
    };

    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.once("error", onError);
    child.once("exit", onExit);
  });
}

async function createLocalhostRunTunnel(port) {
  const executable = await findSshExecutable();
  if (!executable) throw new Error("SSH client not found");

  const child = spawn(
    executable,
    [
      "-o",
      "StrictHostKeyChecking=no",
      "-o",
      "ServerAliveInterval=30",
      "-R",
      `80:127.0.0.1:${port}`,
      `nokey@${LOCALHOST_RUN_HOST}`
    ],
    {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    }
  );

  try {
    const url = await waitForLocalhostRunUrl(child);
    await waitForPublicUrl(url);
    return {
      url,
      tunnelType: "localhost.run",
      stable: false,
      stop: () => child.kill(),
      closed: createChildExitPromise(child, "localhost.run tunnel")
    };
  } catch (error) {
    child.kill();
    throw error;
  }
}

async function createCloudflareTunnel(localUrl) {
  const executable = await findSystemCloudflaredExecutable();
  if (executable) {
    try {
      return await createSystemCloudflareTunnel(localUrl, executable);
    } catch (error) {
      console.warn(`System cloudflared failed: ${error?.message || error}`);
      console.warn("Falling back to bundled Cloudflare tunnel client.");
    }
  }

  let lastError = null;
  for (let attempt = 1; attempt <= CLOUDFLARE_RETRY_LIMIT; attempt += 1) {
    const tunnel = Tunnel.quick(localUrl);
    try {
      const url = await waitForCloudflareUrl(tunnel);
      await waitForPublicUrl(url);
      return {
        url,
        tunnelType: "cloudflare",
        stable: false,
        stop: () => tunnel.stop(),
        closed: new Promise((resolve) => {
          tunnel.once("exit", (code, signal) => {
            resolve(new Error(`Bundled cloudflared tunnel exited: ${code ?? signal ?? "unknown"}`));
          });
          tunnel.once("error", (error) => {
            resolve(error);
          });
        })
      };
    } catch (error) {
      lastError = error;
      try {
        tunnel.stop();
      } catch {}
      if (attempt < CLOUDFLARE_RETRY_LIMIT) {
        console.warn(`Cloudflare tunnel attempt ${attempt} failed: ${error?.message || error}`);
        console.warn("Retrying Cloudflare tunnel...");
      }
    }
  }
  throw lastError || new Error("Cloudflare tunnel failed");
}

async function createPublicTunnel({ localUrl, port }) {
  if (TUNNEL_PROVIDER === "tailscale") return createTailscaleTunnel(port);
  if (TUNNEL_PROVIDER === "localtunnel") {
    throw new Error("localtunnel support was removed because its dependency chain has known high-severity vulnerabilities. Use tailscale, cloudflare, localhostrun, or auto.");
  }
  if (TUNNEL_PROVIDER === "localhostrun") return createLocalhostRunTunnel(port);
  if (TUNNEL_PROVIDER === "auto") {
    try {
      return await createTailscaleTunnel(port);
    } catch (error) {
      console.warn(`Tailscale tunnel unavailable: ${error?.message || error}`);
      console.warn("Falling back to temporary tunnel.");
    }
  }
  try {
    return await createCloudflareTunnel(localUrl);
  } catch (error) {
    console.warn(`Cloudflare tunnel failed: ${error?.message || error}`);
    console.warn("Falling back to localhost.run.");
  }

  try {
    return await createLocalhostRunTunnel(port);
  } catch (error) {
    console.warn(`localhost.run tunnel failed: ${error?.message || error}`);
  }
  throw new Error("No public tunnel provider is currently reachable. Install/login Tailscale or retry Cloudflare/localhost.run later.");
}

async function monitorTunnelHealth(tunnel) {
  let failures = 0;
  while (true) {
    const outcome = await Promise.race([
      sleep(TUNNEL_HEALTHCHECK_INTERVAL_MS).then(() => "tick"),
      (tunnel.closed || createIdlePromise()).then((error) => ({ type: "closed", error }))
    ]);

    if (outcome !== "tick") {
      throw outcome.error || new Error("Tunnel closed");
    }

    if (await probePublicUrl(tunnel.url)) {
      failures = 0;
      continue;
    }

    failures += 1;
    console.warn(`Public tunnel probe failed (${failures}/${TUNNEL_FAILURE_THRESHOLD}): ${tunnel.url}`);
    if (failures >= TUNNEL_FAILURE_THRESHOLD) {
      throw new Error(`Public tunnel became unreachable: ${tunnel.url}`);
    }
  }
}

async function maintainPublicTunnel({ localUrl, port }) {
  while (true) {
    let tunnel = null;
    try {
      tunnel = await createPublicTunnel({ localUrl, port });
      await writeCurrentPublicLink({
        localUrl,
        publicUrl: tunnel.url,
        tunnelType: tunnel.tunnelType,
        stable: tunnel.stable,
        tunnelPasswordIp: tunnel.tunnelPasswordIp || ""
      });
      printBanner({
        localUrl,
        publicUrl: tunnel.url,
        tunnelPasswordIp: tunnel.tunnelPasswordIp
      });
      await monitorTunnelHealth(tunnel);
    } catch (error) {
      console.warn(error?.message || error);
      console.warn("Restarting public tunnel...");
      await writeCurrentPublicLink({
        localUrl,
        publicUrl: tunnel?.url || "",
        tunnelType: tunnel?.tunnelType || "recovering",
        stable: Boolean(tunnel?.stable),
        failureReason: error?.message || String(error || "tunnel failed"),
        tunnelPasswordIp: tunnel?.tunnelPasswordIp || ""
      }).catch(() => {});
    } finally {
      try {
        tunnel?.stop?.();
      } catch {}
    }
    await sleep(TUNNEL_RESTART_DELAY_MS);
  }
}

async function main() {
  const startPort = parsePort(process.env.CODEX_REMOTE_PORT || process.env.CODEX_PUBLIC_START_PORT, DEFAULT_START_PORT);
  const port = await findOpenPort(startPort);
  process.env.CODEX_REMOTE_HOST = "127.0.0.1";
  process.env.CODEX_REMOTE_PORT = String(port);

  await import("./index.js");
  await waitForPort(port);

  const localUrl = `http://127.0.0.1:${port}/`;
  await maintainPublicTunnel({ localUrl, port });
}

main().catch((error) => {
  console.error("");
  console.error("Failed to start public Codex Workbench link.");
  console.error(error?.message || error);
  console.error("");
  process.exit(1);
});
