function walkThreads(threads, visitor) {
  for (const thread of threads || []) {
    visitor(thread);
    if (Array.isArray(thread.subagents) && thread.subagents.length) {
      walkThreads(thread.subagents, visitor);
    }
  }
}

export function detectRolloutChanges(previous, threads, mtimes) {
  const next = new Map();
  const changed = [];

  walkThreads(threads, (thread) => {
    if (!thread.rolloutPath) return;
    const mtime = mtimes.get(thread.rolloutPath);
    if (!Number.isFinite(mtime)) return;
    next.set(thread.rolloutPath, mtime);
    if (previous.has(thread.rolloutPath) && previous.get(thread.rolloutPath) !== mtime) {
      changed.push({ threadId: thread.id, cwd: thread.cwd, rolloutPath: thread.rolloutPath });
    }
  });

  return { next, changed };
}
