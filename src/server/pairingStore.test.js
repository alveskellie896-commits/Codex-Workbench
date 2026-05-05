import os from "node:os";
import path from "node:path";
import { describe, expect, test, vi } from "vitest";
import { PairingStore } from "./pairingStore.js";

function tempStore(now = () => new Date("2026-05-01T00:00:00.000Z")) {
  return new PairingStore({ filePath: path.join(os.tmpdir(), `workbench-pairing-${Date.now()}-${Math.random()}.json`), now });
}

describe("PairingStore", () => {
  test("creates and consumes a one-time pairing code", async () => {
    const store = tempStore();
    const session = await store.createPairingSession({ origin: "http://127.0.0.1:8787" });

    const result = await store.completePairing({ code: session.shortCode, deviceName: "iPhone", fingerprint: "fp" });

    expect(result.device.name).toBe("iPhone");
    expect(result.deviceToken).toEqual(expect.any(String));
    await expect(store.completePairing({ code: session.shortCode, deviceName: "Again" })).rejects.toThrow(/expired|already used/i);
  });

  test("rejects expired pairing codes", async () => {
    let current = new Date("2026-05-01T00:00:00.000Z");
    const store = tempStore(() => current);
    const session = await store.createPairingSession({ origin: "http://127.0.0.1:8787" });

    current = new Date("2026-05-01T00:11:00.000Z");

    await expect(store.completePairing({ code: session.shortCode, deviceName: "Late" })).rejects.toThrow(/expired/i);
  });

  test("trusted device login fails after revocation", async () => {
    const store = tempStore();
    const session = await store.createPairingSession({ origin: "http://127.0.0.1:8787" });
    const result = await store.completePairing({ code: session.shortCode, deviceName: "iPhone", fingerprint: "fp" });

    expect(await store.verifyDevice({ deviceId: result.device.id, deviceToken: result.deviceToken, fingerprint: "fp" })).toMatchObject({ id: result.device.id });

    await store.revokeDevice(result.device.id);

    expect(await store.verifyDevice({ deviceId: result.device.id, deviceToken: result.deviceToken, fingerprint: "fp" })).toBeNull();
  });

  test("records audit events without storing raw trust token", async () => {
    const store = tempStore();
    const session = await store.createPairingSession({ origin: "http://127.0.0.1:8787" });
    const result = await store.completePairing({ code: session.shortCode, deviceName: "iPhone", fingerprint: "fp" });
    const data = await store.load();

    expect(JSON.stringify(data)).not.toContain(result.deviceToken);
    expect((await store.auditLog()).length).toBeGreaterThan(0);
  });
});
