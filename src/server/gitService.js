import { execFile } from "node:child_process";
import path from "node:path";

const GIT_TIMEOUT_MS = 30000;
const SAFE_ACTIONS = new Set(["commit", "push", "pull", "checkout", "create-branch", "stash"]);

function execGit(cwd, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile("git", args, { cwd, timeout: options.timeoutMs || GIT_TIMEOUT_MS, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        const friendly = humanizeGitError(stderr || stdout || error.message, args);
        friendly.code = error.code;
        reject(friendly);
        return;
      }
      resolve(String(stdout || "").trim());
    });
  });
}

function humanizeGitError(message, args = []) {
  const text = String(message || "").trim();
  let userMessage = text || "Git command failed.";
  if (/not a git repository/i.test(text)) userMessage = "This folder is not a Git repository.";
  else if (/no upstream|has no upstream/i.test(text)) userMessage = "This branch has no remote tracking branch yet.";
  else if (/Authentication failed|Permission denied|could not read Username/i.test(text)) userMessage = "Git could not sign in to the remote. Check your Git credentials on the computer.";
  else if (/CONFLICT|Automatic merge failed/i.test(text)) userMessage = "Git stopped because there is a merge conflict. Resolve it on the computer before continuing.";
  else if (/nothing to commit|working tree clean/i.test(text)) userMessage = "There is nothing to commit.";
  const error = new Error(userMessage);
  error.raw = text;
  error.gitArgs = args;
  return error;
}

function assertSafeAction(action) {
  if (!SAFE_ACTIONS.has(action)) {
    const error = new Error("This Git action is not available from the phone panel.");
    error.statusCode = 400;
    throw error;
  }
}

function normalizeBranchName(value) {
  const branch = String(value || "").trim();
  if (!branch || branch.includes("..") || branch.startsWith("-") || /[\r\n~^:?*[\\]/.test(branch)) {
    const error = new Error("Branch name is not safe.");
    error.statusCode = 400;
    throw error;
  }
  return branch;
}

function requireConfirmation(action, confirm) {
  const expected = `confirm:${action}`;
  if (confirm !== expected) {
    const error = new Error(`Please confirm this Git action with "${expected}".`);
    error.statusCode = 428;
    throw error;
  }
}

function parsePorcelainLine(line) {
  return {
    status: line.slice(0, 2).trim() || "changed",
    path: line.slice(3).trim()
  };
}

async function isGitRepo(cwd) {
  try {
    return (await execGit(cwd, ["rev-parse", "--is-inside-work-tree"])) === "true";
  } catch {
    return false;
  }
}

export async function gitStatus(cwd) {
  const safeCwd = path.resolve(cwd || process.cwd());
  if (!(await isGitRepo(safeCwd))) {
    return {
      cwd: safeCwd,
      repository: false,
      branch: "",
      clean: true,
      files: [],
      shortStat: "",
      recentCommits: [],
      message: "This folder is not a Git repository."
    };
  }

  const [branch, porcelain, shortStat, log] = await Promise.all([
    execGit(safeCwd, ["branch", "--show-current"]).catch(() => ""),
    execGit(safeCwd, ["status", "--porcelain=v1"]).catch(() => ""),
    execGit(safeCwd, ["diff", "--shortstat"]).catch(() => ""),
    execGit(safeCwd, ["log", "--oneline", "-5"]).catch(() => "")
  ]);

  const files = porcelain.split(/\r?\n/).filter(Boolean).map(parsePorcelainLine);
  return {
    cwd: safeCwd,
    repository: true,
    branch: branch || "detached",
    clean: files.length === 0,
    files,
    shortStat,
    recentCommits: log.split(/\r?\n/).filter(Boolean).map((line) => {
      const [hash, ...message] = line.split(" ");
      return { hash, message: message.join(" ") };
    })
  };
}

export async function gitBranches(cwd) {
  const output = await execGit(cwd, ["branch", "--list"]);
  return output.split(/\r?\n/).filter(Boolean).map((line) => ({
    current: line.startsWith("*"),
    name: line.replace(/^\*\s*/, "").trim()
  }));
}

export async function runGitAction(cwd, action, params = {}) {
  assertSafeAction(action);
  requireConfirmation(action, params.confirm);
  const safeCwd = path.resolve(cwd || process.cwd());

  switch (action) {
    case "commit": {
      const message = String(params.message || "").trim();
      if (!message) {
        const error = new Error("Commit message is required.");
        error.statusCode = 400;
        throw error;
      }
      await execGit(safeCwd, ["add", "-A"]);
      const output = await execGit(safeCwd, ["commit", "-m", message], { timeoutMs: 60000 });
      return { action, output, status: await gitStatus(safeCwd) };
    }
    case "push": {
      const output = await execGit(safeCwd, ["push"], { timeoutMs: 120000 });
      return { action, output, status: await gitStatus(safeCwd) };
    }
    case "pull": {
      const output = await execGit(safeCwd, ["pull", "--ff-only"], { timeoutMs: 120000 });
      return { action, output, status: await gitStatus(safeCwd) };
    }
    case "checkout": {
      const branch = normalizeBranchName(params.branch);
      const output = await execGit(safeCwd, ["checkout", branch]);
      return { action, output, status: await gitStatus(safeCwd) };
    }
    case "create-branch": {
      const branch = normalizeBranchName(params.branch);
      const output = await execGit(safeCwd, ["checkout", "-b", branch]);
      return { action, output, status: await gitStatus(safeCwd) };
    }
    case "stash": {
      const message = String(params.message || "Workbench phone stash").trim().slice(0, 120);
      const output = await execGit(safeCwd, ["stash", "push", "-u", "-m", message]);
      return { action, output, status: await gitStatus(safeCwd) };
    }
    default:
      throw new Error("Unsupported Git action.");
  }
}

export function gitActionHelp() {
  return {
    readonly: ["status", "branches", "recent commits", "short diff stat"],
    safeActions: Array.from(SAFE_ACTIONS),
    hiddenHighRiskActions: ["reset", "clean", "force-push", "delete-branch"],
    confirmationFormat: "confirm:<action>"
  };
}
