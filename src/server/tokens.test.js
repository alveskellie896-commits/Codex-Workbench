import { afterEach, describe, expect, test, vi } from "vitest";

async function loadTokensModule() {
  vi.resetModules();
  return import("./tokens.js");
}

afterEach(() => {
  vi.useRealTimers();
});

describe("token issuing and validation", () => {
  test("issueTokenPair returns valid hashed access and refresh credentials", async () => {
    const { issueTokenPair, refreshAccessToken, validateAccessToken, tokenDiagnostics } = await loadTokensModule();

    const pair = issueTokenPair({ deviceId: "device-a", authMethod: "trusted-device" });

    expect(pair.accessToken).toEqual(expect.any(String));
    expect(pair.refreshToken).toEqual(expect.any(String));
    expect(pair.accessToken).not.toBe(pair.refreshToken);
    expect(pair.expiresIn).toBe(30 * 60);
    expect(pair.deviceId).toBe("device-a");
    expect(validateAccessToken(pair.accessToken)).toBe(true);

    const refreshed = refreshAccessToken(pair.refreshToken);
    expect(refreshed).toMatchObject({ accessToken: expect.any(String), refreshToken: expect.any(String), expiresIn: 30 * 60 });
    expect(tokenDiagnostics().hashedStorage).toBe(true);
  });

  test("validateAccessToken rejects missing, unknown, and expired tokens", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-25T00:00:00.000Z"));
    const { issueTokenPair, validateAccessToken } = await loadTokensModule();
    const pair = issueTokenPair();

    expect(validateAccessToken()).toBe(false);
    expect(validateAccessToken("not-issued")).toBe(false);
    expect(validateAccessToken(pair.accessToken)).toBe(true);

    vi.setSystemTime(new Date("2026-04-25T00:30:00.001Z"));

    expect(validateAccessToken(pair.accessToken)).toBe(false);
    expect(validateAccessToken(pair.accessToken)).toBe(false);
  });

  test("revokeAllTokens invalidates existing access and refresh credentials", async () => {
    const { issueTokenPair, refreshAccessToken, revokeAllTokens, validateAccessToken } = await loadTokensModule();
    const pair = issueTokenPair();

    expect(validateAccessToken(pair.accessToken)).toBe(true);

    revokeAllTokens();

    expect(validateAccessToken(pair.accessToken)).toBe(false);
    expect(refreshAccessToken(pair.refreshToken)).toBeNull();
  });

  test("revokeTokensForDevice invalidates only that device", async () => {
    const { issueTokenPair, revokeTokensForDevice, validateAccessToken } = await loadTokensModule();
    const a = issueTokenPair({ deviceId: "a" });
    const b = issueTokenPair({ deviceId: "b" });

    expect(revokeTokensForDevice("a")).toBeGreaterThan(0);

    expect(validateAccessToken(a.accessToken)).toBe(false);
    expect(validateAccessToken(b.accessToken)).toBe(true);
  });
});

describe("refreshAccessToken", () => {
  test("rotates refresh tokens", async () => {
    const { issueTokenPair, refreshAccessToken, validateAccessToken } = await loadTokensModule();
    const pair = issueTokenPair();

    const refreshed = refreshAccessToken(pair.refreshToken);

    expect(refreshed).toEqual({
      accessToken: expect.any(String),
      refreshToken: expect.any(String),
      expiresIn: 30 * 60,
      deviceId: "",
      authMethod: "password",
      trustLevel: "password"
    });
    expect(refreshed.accessToken).not.toBe(pair.accessToken);
    expect(refreshed.refreshToken).not.toBe(pair.refreshToken);
    expect(validateAccessToken(refreshed.accessToken)).toBe(true);
    expect(refreshAccessToken(pair.refreshToken)).toBeNull();
  });

  test("rejects missing, unknown, and expired refresh tokens", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-25T00:00:00.000Z"));
    const { issueTokenPair, refreshAccessToken } = await loadTokensModule();
    const pair = issueTokenPair();

    expect(refreshAccessToken()).toBeNull();
    expect(refreshAccessToken("not-issued")).toBeNull();
    expect(refreshAccessToken(pair.refreshToken)).toEqual({
      accessToken: expect.any(String),
      refreshToken: expect.any(String),
      expiresIn: 30 * 60,
      deviceId: "",
      authMethod: "password",
      trustLevel: "password"
    });

    vi.setSystemTime(new Date("2026-05-25T00:00:00.001Z"));

    expect(refreshAccessToken(pair.refreshToken)).toBeNull();
  });
});
