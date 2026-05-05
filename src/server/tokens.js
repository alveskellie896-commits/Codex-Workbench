import crypto from "node:crypto";
import { ACCESS_TOKEN_TTL_MS, REFRESH_TOKEN_TTL_MS } from "./config.js";

const accessTokens = new Map();
const refreshTokens = new Map();

function now() {
  return Date.now();
}

function hashToken(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("base64url");
}

function createRawToken() {
  return crypto.randomBytes(32).toString("base64url");
}

function pruneExpired(store) {
  const currentTime = now();
  for (const [hash, session] of store.entries()) {
    if (!session?.expiresAt || session.expiresAt <= currentTime) store.delete(hash);
  }
}

function createSession(store, ttlMs, metadata = {}) {
  pruneExpired(store);
  const token = createRawToken();
  const session = {
    tokenHash: hashToken(token),
    createdAt: new Date().toISOString(),
    expiresAt: now() + ttlMs,
    deviceId: metadata.deviceId || "",
    authMethod: metadata.authMethod || "password",
    trustLevel: metadata.trustLevel || "password",
    rotatedFrom: metadata.rotatedFrom || ""
  };
  store.set(session.tokenHash, session);
  return { token, session };
}

function publicTokenPair(access, refresh) {
  return {
    accessToken: access.token,
    refreshToken: refresh.token,
    expiresIn: Math.floor(ACCESS_TOKEN_TTL_MS / 1000),
    deviceId: access.session.deviceId || "",
    authMethod: access.session.authMethod || "password",
    trustLevel: access.session.trustLevel || "password"
  };
}

export function issueTokenPair(metadata = {}) {
  const access = createSession(accessTokens, ACCESS_TOKEN_TTL_MS, metadata);
  const refresh = createSession(refreshTokens, REFRESH_TOKEN_TTL_MS, metadata);
  return publicTokenPair(access, refresh);
}

export function refreshAccessToken(refreshToken) {
  const refreshHash = hashToken(refreshToken);
  pruneExpired(refreshTokens);
  const session = refreshTokens.get(refreshHash);
  if (!session) return null;
  refreshTokens.delete(refreshHash);
  const metadata = {
    deviceId: session.deviceId || "",
    authMethod: session.authMethod || "refresh",
    trustLevel: session.trustLevel || "password",
    rotatedFrom: refreshHash
  };
  const access = createSession(accessTokens, ACCESS_TOKEN_TTL_MS, metadata);
  const refresh = createSession(refreshTokens, REFRESH_TOKEN_TTL_MS, metadata);
  return publicTokenPair(access, refresh);
}

export function getAccessSession(token) {
  const tokenHash = hashToken(token);
  pruneExpired(accessTokens);
  const session = accessTokens.get(tokenHash);
  if (!session) return null;
  return { ...session };
}

export function validateAccessToken(token) {
  return Boolean(getAccessSession(token));
}

export function revokeAllTokens() {
  accessTokens.clear();
  refreshTokens.clear();
}

export function revokeTokensForDevice(deviceId) {
  const target = String(deviceId || "");
  if (!target) return 0;
  let revoked = 0;
  for (const [hash, session] of accessTokens.entries()) {
    if (session.deviceId === target) {
      accessTokens.delete(hash);
      revoked += 1;
    }
  }
  for (const [hash, session] of refreshTokens.entries()) {
    if (session.deviceId === target) {
      refreshTokens.delete(hash);
      revoked += 1;
    }
  }
  return revoked;
}

export function tokenDiagnostics() {
  pruneExpired(accessTokens);
  pruneExpired(refreshTokens);
  return {
    accessTokens: accessTokens.size,
    refreshTokens: refreshTokens.size,
    hashedStorage: true,
    accessTtlSeconds: Math.floor(ACCESS_TOKEN_TTL_MS / 1000),
    refreshTtlSeconds: Math.floor(REFRESH_TOKEN_TTL_MS / 1000)
  };
}
