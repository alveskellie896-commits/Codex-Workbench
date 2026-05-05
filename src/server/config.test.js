import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";

const tempDirs = [];

async function withTempEnvFile(contents) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-config-"));
  tempDirs.push(dir);
  await fs.writeFile(path.join(dir, ".env"), contents);
  return dir;
}

afterEach(async () => {
  delete process.env.CODEX_REMOTE_HOST;
  delete process.env.CODEX_REMOTE_PORT;
  delete process.env.CODEX_REMOTE_PASSWORD;
  vi.resetModules();
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { force: true, recursive: true })));
});

describe("config", () => {
  test("loads .env values when environment variables are not already set", async () => {
    const cwd = process.cwd();
    const dir = await withTempEnvFile(`
CODEX_REMOTE_HOST=0.0.0.0
CODEX_REMOTE_PORT=9999
CODEX_REMOTE_PASSWORD="local-password"
`);
    process.chdir(dir);
    try {
      const config = await import("./config.js");
      expect(config.HOST).toBe("0.0.0.0");
      expect(config.PORT).toBe(9999);
      expect(config.PASSWORD).toBe("local-password");
    } finally {
      process.chdir(cwd);
    }
  });

  test("keeps explicit environment variables over .env values", async () => {
    const cwd = process.cwd();
    const dir = await withTempEnvFile("CODEX_REMOTE_PORT=9999\n");
    process.env.CODEX_REMOTE_PORT = "8788";
    process.chdir(dir);
    try {
      const config = await import("./config.js");
      expect(config.PORT).toBe(8788);
    } finally {
      process.chdir(cwd);
    }
  });

  test("expands CODEX_HOME tilde paths", async () => {
    const cwd = process.cwd();
    const dir = await withTempEnvFile("CODEX_HOME=~/.codex\n");
    process.chdir(dir);
    try {
      const config = await import("./config.js");
      expect(config.CODEX_HOME).toBe(path.join(os.homedir(), ".codex"));
    } finally {
      process.chdir(cwd);
    }
  });
});
