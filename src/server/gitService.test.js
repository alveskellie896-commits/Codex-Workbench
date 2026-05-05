import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, test } from "vitest";
import { gitStatus, runGitAction } from "./gitService.js";

const execFileAsync = promisify(execFile);

async function git(cwd, ...args) {
  return execFileAsync("git", args, { cwd });
}

async function makeRepo() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "workbench-git-"));
  await git(dir, "init");
  await git(dir, "config", "user.email", "test@example.com");
  await git(dir, "config", "user.name", "Workbench Test");
  await fs.writeFile(path.join(dir, "README.md"), "hello\n", "utf8");
  await git(dir, "add", "README.md");
  await git(dir, "commit", "-m", "initial");
  return dir;
}

describe("gitService", () => {
  test("returns read-only status for a repository", async () => {
    const dir = await makeRepo();
    await fs.writeFile(path.join(dir, "demo.txt"), "changed\n", "utf8");

    const status = await gitStatus(dir);

    expect(status.repository).toBe(true);
    expect(status.clean).toBe(false);
    expect(status.files.map((file) => file.path)).toContain("demo.txt");
  });

  test("requires explicit confirmation for commit", async () => {
    const dir = await makeRepo();
    await fs.writeFile(path.join(dir, "demo.txt"), "changed\n", "utf8");

    await expect(runGitAction(dir, "commit", { message: "demo" })).rejects.toThrow(/confirm:commit/);

    const result = await runGitAction(dir, "commit", { message: "demo", confirm: "confirm:commit" });
    expect(result.status.clean).toBe(true);
  });

  test("rejects high-risk unsupported actions", async () => {
    const dir = await makeRepo();
    await expect(runGitAction(dir, "reset", { confirm: "confirm:reset" })).rejects.toThrow(/not available/i);
  });

  test("validates branch names", async () => {
    const dir = await makeRepo();
    await expect(runGitAction(dir, "create-branch", { branch: "../bad", confirm: "confirm:create-branch" })).rejects.toThrow(/not safe/i);
  });
});
