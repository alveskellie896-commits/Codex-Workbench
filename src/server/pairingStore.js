import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import QRCode from "qrcode";
import { codexPath } from "./config.js";

const SHORT_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const DEFAULT_PAIRING_TTL_MS = 10 * 60 * 1000;
const DEFAULT_DEVICE_LEVEL = "phone";
const MAX_AUDIT_EVENTS = 120;

function isoNow(now = () => new Date()) {
  return now().toISOString();
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("base64url");
}

function secretHash(secret, salt) {
  return crypto.createHmac("sha256", salt).update(String(secret || "")).digest("base64url");
}

function randomId(prefix = "") {
  return `${prefix}${crypto.randomBytes(12).toString("base64url")}`;
}

function shortCode(length = 10) {
  const bytes = crypto.randomBytes(length);
  let code = "";
  for (let index = 0; index < bytes.length; index += 1) {
    code += SHORT_CODE_ALPHABET[bytes[index] % SHORT_CODE_ALPHABET.length];
  }
  return code;
}

function normalizeDeviceName(value) {
  const name = String(value || "").trim().replace(/\s+/g, " ");
  return name.slice(0, 64) || "My phone";
}

function normalizePermissionLevel(value) {
  const level = String(value || "").trim().toLowerCase();
  return ["phone", "admin", "readonly"].includes(level) ? level : DEFAULT_DEVICE_LEVEL;
}

function sanitizeDevice(device) {
  return {
    id: device.id,
    name: device.name,
    createdAt: device.createdAt,
    lastSeenAt: device.lastSeenAt || "",
    revokedAt: device.revokedAt || "",
    permissionLevel: normalizePermissionLevel(device.permissionLevel),
    fingerprintDigest: device.fingerprintDigest || "",
    userAgent: device.userAgent || ""
  };
}

function defaultData() {
  return { version: 1, sessions: [], devices: [], audit: [] };
}

async function createPairingSvg({ code, pairingUrl }) {
  const url = String(pairingUrl || "");
  if (!url) return "";
  const title = `Pair Codex Workbench phone ${String(code || "")}`.replace(/[<>&"]/g, "");
  const svg = await QRCode.toString(url, {
    type: "svg",
    errorCorrectionLevel: "M",
    margin: 2,
    width: 220,
    color: {
      dark: "#0f172a",
      light: "#ffffff"
    }
  });
  return svg.replace("<svg", `<svg role="img" aria-label="${title}"`);
}

export class PairingStore {
  constructor({ filePath = codexPath("workbench-trusted-devices.json"), now = () => new Date() } = {}) {
    this.filePath = filePath;
    this.now = now;
  }

  async load() {
    try {
      const raw = await fsp.readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw);
      return {
        ...defaultData(),
        ...parsed,
        sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
        devices: Array.isArray(parsed.devices) ? parsed.devices : [],
        audit: Array.isArray(parsed.audit) ? parsed.audit : []
      };
    } catch {
      return defaultData();
    }
  }

  async save(data) {
    await fsp.mkdir(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.${process.pid}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(data, null, 2), "utf8");
    await fsp.rename(tmp, this.filePath);
  }

  async resetForTests(data = defaultData()) {
    await this.save(data);
  }

  addAudit(data, event) {
    data.audit = [
      {
        id: randomId("audit_"),
        event: event.event,
        deviceId: event.deviceId || "",
        sessionId: event.sessionId || "",
        detail: event.detail || "",
        ip: event.ip || "",
        userAgent: event.userAgent || "",
        at: isoNow(this.now)
      },
      ...(data.audit || [])
    ].slice(0, MAX_AUDIT_EVENTS);
  }

  pruneSessions(data) {
    const current = this.now().getTime();
    data.sessions = (data.sessions || []).filter((session) => {
      if (session.usedAt) return false;
      return new Date(session.expiresAt).getTime() > current;
    });
  }

  async createPairingSession({ origin = "", permissionLevel = DEFAULT_DEVICE_LEVEL, createdBy = "password", ip = "" } = {}) {
    const data = await this.load();
    this.pruneSessions(data);
    const sessionId = randomId("pair_");
    const code = shortCode();
    const expiresAt = new Date(this.now().getTime() + DEFAULT_PAIRING_TTL_MS).toISOString();
    const pairingUrl = `${String(origin || "").replace(/\/$/, "")}/pair?code=${encodeURIComponent(code)}`;
    const session = {
      id: sessionId,
      codeHash: sha256(code),
      createdAt: isoNow(this.now),
      expiresAt,
      usedAt: "",
      permissionLevel: normalizePermissionLevel(permissionLevel),
      createdBy
    };
    data.sessions.unshift(session);
    this.addAudit(data, { event: "pairing.created", sessionId, detail: "One-time phone pairing code created", ip });
    await this.save(data);
    return {
      sessionId,
      shortCode: code,
      expiresAt,
      pairingUrl,
      qrSvg: await createPairingSvg({ code, pairingUrl, expiresAt }),
      ttlSeconds: Math.floor(DEFAULT_PAIRING_TTL_MS / 1000)
    };
  }

  async completePairing({ code = "", deviceName = "", fingerprint = "", userAgent = "", ip = "" } = {}) {
    const normalizedCode = String(code || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!normalizedCode) {
      const error = new Error("Pairing code is missing.");
      error.statusCode = 400;
      throw error;
    }

    const data = await this.load();
    this.pruneSessions(data);
    const codeHash = sha256(normalizedCode);
    const session = data.sessions.find((item) => item.codeHash === codeHash);
    if (!session) {
      const error = new Error("Pairing code expired or was already used.");
      error.statusCode = 410;
      throw error;
    }
    if (session.usedAt) {
      const error = new Error("Pairing code was already used.");
      error.statusCode = 409;
      throw error;
    }
    if (new Date(session.expiresAt).getTime() <= this.now().getTime()) {
      const error = new Error("Pairing code expired. Create a new code on the computer.");
      error.statusCode = 410;
      throw error;
    }

    const deviceToken = randomId("trust_");
    const tokenSalt = crypto.randomBytes(16).toString("base64url");
    const device = {
      id: randomId("device_"),
      name: normalizeDeviceName(deviceName),
      createdAt: isoNow(this.now),
      lastSeenAt: isoNow(this.now),
      revokedAt: "",
      permissionLevel: normalizePermissionLevel(session.permissionLevel),
      tokenSalt,
      tokenHash: secretHash(deviceToken, tokenSalt),
      fingerprintDigest: sha256(fingerprint || userAgent || "unknown-device"),
      userAgent: String(userAgent || "").slice(0, 220)
    };

    session.usedAt = isoNow(this.now);
    data.devices.unshift(device);
    this.addAudit(data, { event: "device.paired", deviceId: device.id, sessionId: session.id, detail: device.name, ip, userAgent });
    await this.save(data);
    return { device: sanitizeDevice(device), deviceToken };
  }

  async verifyDevice({ deviceId = "", deviceToken = "", fingerprint = "", ip = "", userAgent = "" } = {}) {
    const data = await this.load();
    const device = data.devices.find((item) => item.id === deviceId);
    if (!device || device.revokedAt) return null;
    const tokenOk = secretHash(deviceToken, device.tokenSalt) === device.tokenHash;
    if (!tokenOk) {
      this.addAudit(data, { event: "device.login.failed", deviceId, detail: "Trust token did not match", ip, userAgent });
      await this.save(data);
      return null;
    }
    device.lastSeenAt = isoNow(this.now);
    if (fingerprint) device.fingerprintDigest = sha256(fingerprint);
    this.addAudit(data, { event: "device.login", deviceId, detail: device.name, ip, userAgent });
    await this.save(data);
    return sanitizeDevice(device);
  }

  async listDevices() {
    const data = await this.load();
    return data.devices.map(sanitizeDevice);
  }

  async renameDevice(deviceId, name) {
    const data = await this.load();
    const device = data.devices.find((item) => item.id === deviceId);
    if (!device || device.revokedAt) {
      const error = new Error("Trusted device was not found.");
      error.statusCode = 404;
      throw error;
    }
    device.name = normalizeDeviceName(name);
    this.addAudit(data, { event: "device.renamed", deviceId, detail: device.name });
    await this.save(data);
    return sanitizeDevice(device);
  }

  async revokeDevice(deviceId, { ip = "", userAgent = "" } = {}) {
    const data = await this.load();
    const device = data.devices.find((item) => item.id === deviceId);
    if (!device) {
      const error = new Error("Trusted device was not found.");
      error.statusCode = 404;
      throw error;
    }
    if (!device.revokedAt) device.revokedAt = isoNow(this.now);
    this.addAudit(data, { event: "device.revoked", deviceId, detail: device.name, ip, userAgent });
    await this.save(data);
    return sanitizeDevice(device);
  }

  async isDeviceRevoked(deviceId) {
    if (!deviceId) return false;
    const data = await this.load();
    const device = data.devices.find((item) => item.id === deviceId);
    return Boolean(device?.revokedAt);
  }

  async auditLog() {
    const data = await this.load();
    return data.audit || [];
  }

  async diagnostics() {
    const data = await this.load();
    this.pruneSessions(data);
    const activeDevices = data.devices.filter((device) => !device.revokedAt).length;
    const revokedDevices = data.devices.filter((device) => device.revokedAt).length;
    return {
      configured: fs.existsSync(this.filePath),
      filePath: this.filePath,
      trustedDevices: activeDevices,
      revokedDevices,
      activePairingSessions: data.sessions.length,
      tokenStorage: "hashed device trust tokens",
      auditEvents: data.audit.length
    };
  }
}

export const pairingStore = new PairingStore();
