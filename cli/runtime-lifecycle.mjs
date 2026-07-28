import {spawnSync} from 'node:child_process';

/** Web runtime 的唯一 shutdown 入口：先停止接新请求，再回收任务，绝不抢在异步收尾前退出。 */
export const installRuntimeShutdown = ({server, killAll, processImpl = process, deadlineMs = 8000}) => {
  let shutdownPromise = null;
  const closeServer = () => new Promise((resolve) => {
    server.close(() => resolve());
  });
  const shutdown = (signal) => {
    if (shutdownPromise) return shutdownPromise;
    // close stops accepting new connections. A stuck SSE/request must not keep a
    // SIGTERM handler alive forever, so the global deadline force-closes it.
    const serverClosed = closeServer();
    const jobsStopped = Promise.resolve(killAll({deadlineMs}));
    const deadline = new Promise((resolve) => setTimeout(resolve, deadlineMs));
    shutdownPromise = Promise.race([
      Promise.all([jobsStopped, serverClosed]).then(([jobs]) => ({timedOut: false, clean: jobs?.clean !== false})),
      deadline.then(() => ({timedOut: true, clean: false})),
    ]).then(({timedOut, clean}) => {
      if (timedOut) server.closeAllConnections?.();
      // Non-zero preserves an unconfirmed durable lease for stale cleanup on
      // the next startup instead of pretending cancellation completed.
      processImpl.exitCode = !clean ? 1 : signal === 'SIGINT' ? 130 : 143;
      return {clean: !timedOut && clean};
    });
    return shutdownPromise;
  };
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    processImpl.once(signal, () => { void shutdown(signal); });
  }
  return shutdown;
};

const command = (file, args) => {
  try {
    const result = spawnSync(file, args, {encoding: 'utf8', timeout: 2000, windowsHide: true});
    if (result.error || result.signal) return {state: 'unknown'};
    return {state: 'ok', status: result.status, stdout: result.stdout ?? ''};
  } catch { return {state: 'unknown'}; }
};

const posixIdentity = (pid) => {
  const result = command('ps', ['-p', String(pid), '-o', 'lstart=']);
  if (result.state === 'unknown') return result;
  const start = result.stdout.trim();
  if (start) return {state: 'alive', start};
  if (result.status === 1) return {state: 'dead'};
  return {state: 'unknown'};
};

const windowsIdentity = (pid) => {
  // CIM exposes creation time, unlike tasklist. Do not treat a PID-only result
  // as proof: it could be a reused PID.
  const script = `Get-CimInstance Win32_Process -Filter \"ProcessId = ${pid}\" | Select-Object -ExpandProperty CreationDate`;
  const result = command('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script]);
  if (result.state === 'ok') {
    const start = result.stdout.trim();
    if (start) return {state: 'alive', start};
    if (result.status === 0) return {state: 'dead'};
  }
  // A working tasklist can only prove absence. Presence without a creation
  // timestamp remains unknown and therefore cannot be reclaimed.
  const fallback = command('tasklist.exe', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH']);
  if (fallback.state === 'ok' && fallback.status === 0) {
    if (/^INFO:/i.test(fallback.stdout.trim())) return {state: 'dead'};
  }
  return {state: 'unknown'};
};

const processIdentity = (pid, {platform = process.platform} = {}) => {
  if (!Number.isInteger(pid) || pid <= 0) return {state: 'unknown'};
  return platform === 'win32' ? windowsIdentity(pid) : posixIdentity(pid);
};

export const executorIdentity = (pid, options) => {
  const identity = processIdentity(pid, options);
  return identity.state === 'alive' ? {pid, start: identity.start} : {pid, start: null};
};

/** `unknown` deliberately blocks stale recovery rather than risking PID reuse. */
export const executorLiveness = ({pid, start}, options) => {
  if (!Number.isInteger(pid) || pid <= 0 || typeof start !== 'string' || !start) return 'unknown';
  const current = processIdentity(pid, options);
  if (current.state === 'dead') return 'dead';
  if (current.state !== 'alive') return 'unknown';
  return current.start === start ? 'alive' : 'dead';
};

export const isExecutorAlive = (executor, options) => executorLiveness(executor, options) === 'alive';

/** Snapshot only on POSIX. Windows taskkill owns tree discovery itself. */
export const snapshotExecutorDescendants = (rootPid, {platform = process.platform, commandImpl = command} = {}) => {
  if (platform === 'win32') return {known: true, descendants: []};
  const result = commandImpl('ps', ['-Ao', 'pid=,ppid=,lstart=']);
  if (result.state !== 'ok' || result.status !== 0) return {known: false, descendants: []};
  const children = new Map();
  for (const line of result.stdout.split('\n')) {
    const match = /^\s*(\d+)\s+(\d+)\s+(.*\S)\s*$/.exec(line);
    if (!match) continue;
    const parent = Number(match[2]);
    children.set(parent, [...(children.get(parent) ?? []), {pid: Number(match[1]), start: match[3]}]);
  }
  const descendants = [];
  const queue = [rootPid];
  while (queue.length) for (const child of children.get(queue.shift()) ?? []) { descendants.push(child); queue.push(child.pid); }
  return {known: true, descendants};
};

/** Signal verified identities; never rely on a negative process-group pid. */
export const signalExecutorTree = (executor, descendants, signal, {
  killImpl = process.kill,
  platform = process.platform,
  liveness = (identity) => executorLiveness(identity, {platform}),
} = {}) => {
  if (platform === 'win32') return false;
  // An unrecorded identity is not a permission to signal a PID (or any PID
  // reached through it): a reused PID could otherwise kill an unrelated tree.
  if (!executor || !Number.isInteger(executor.pid) || executor.pid <= 0 || typeof executor.start !== 'string' || !executor.start) return false;
  const rootState = liveness(executor);
  if (rootState === 'unknown') return false;
  for (const descendant of descendants) {
    if (liveness(descendant) !== 'alive') continue;
    try { killImpl(descendant.pid, signal); } catch { /* exited after verification */ }
  }
  // The direct executor can already be gone while detached descendants remain.
  // They were snapshotted before termination, so continue to drain that fixed
  // set instead of letting a dead root suppress their TERM/KILL delivery.
  if (rootState === 'dead') return true;
  try { killImpl(executor.pid, signal); return true; } catch { return false; }
};

/** Signal the detached executor's process group first, falling back to its root.
 * The root identity check makes both forms safe against PID reuse. */
export const signalExecutorGroupOrRoot = (executor, signal, {
  killImpl = process.kill,
  platform = process.platform,
  liveness = (identity) => executorLiveness(identity, {platform}),
} = {}) => {
  if (platform === 'win32' || !executor || !Number.isInteger(executor.pid) || executor.pid <= 0 || typeof executor.start !== 'string' || !executor.start) return false;
  if (liveness(executor) !== 'alive') return false;
  try { killImpl(-executor.pid, signal); return true; }
  catch {
    try { killImpl(executor.pid, signal); return true; }
    catch { return false; }
  }
};

const unionDescendants = (left, right) => {
  const merged = new Map();
  for (const descendant of [...left, ...right]) {
    if (!Number.isInteger(descendant?.pid) || descendant.pid <= 0 || typeof descendant.start !== 'string' || !descendant.start) continue;
    merged.set(`${descendant.pid}:${descendant.start}`, descendant);
  }
  return [...merged.values()];
};

const verifiedIdentity = (identity) => Number.isInteger(identity?.pid) && identity.pid > 0
  && typeof identity.start === 'string' && identity.start;

/**
 * Freeze a POSIX executor before taking its final descendant snapshot.  A
 * process group catches the normal case; detached children are stopped one by
 * one as they are discovered.  This closes the fork/reparent window before
 * TERM can make an otherwise reachable descendant disappear from `ps`.
 */
export const freezeExecutorTree = (executor, {
  killImpl = process.kill,
  platform = process.platform,
  liveness = (identity) => executorLiveness(identity, {platform}),
  snapshot,
  deadlineMs = 250,
  now = Date.now,
} = {}) => {
  if (platform === 'win32' || !verifiedIdentity(executor) || typeof snapshot !== 'function') {
    return {confirmed: false, descendants: [], frozen: []};
  }
  if (liveness(executor) !== 'alive' || !signalExecutorGroupOrRoot(executor, 'SIGSTOP', {killImpl, platform, liveness})) {
    return {confirmed: false, descendants: [], frozen: []};
  }
  const frozen = [executor];
  let descendants = [];
  let stableRounds = 0;
  const deadline = now() + deadlineMs;
  while (now() <= deadline && stableRounds < 2) {
    const current = snapshot();
    if (!current?.known) return {confirmed: false, descendants, frozen};
    const merged = unionDescendants(descendants, current.descendants ?? []);
    const known = new Set(descendants.map((identity) => `${identity.pid}:${identity.start}`));
    const newlyObserved = merged.filter((identity) => !known.has(`${identity.pid}:${identity.start}`));
    for (const identity of newlyObserved) {
      if (!verifiedIdentity(identity) || liveness(identity) === 'unknown') return {confirmed: false, descendants: merged, frozen};
      if (liveness(identity) === 'alive') {
        try { killImpl(identity.pid, 'SIGSTOP'); } catch { return {confirmed: false, descendants: merged, frozen}; }
        frozen.push(identity);
      }
    }
    descendants = merged;
    stableRounds = newlyObserved.length === 0 ? stableRounds + 1 : 0;
  }
  return {confirmed: stableRounds >= 2, descendants, frozen};
};

/** Resume every identity that a failed or completed freeze may have stopped. */
export const resumeFrozenExecutorTree = (executor, descendants, {
  killImpl = process.kill,
  platform = process.platform,
  liveness = (identity) => executorLiveness(identity, {platform}),
} = {}) => {
  if (platform === 'win32') return false;
  let resumed = false;
  if (verifiedIdentity(executor) && liveness(executor) === 'alive') {
    resumed = signalExecutorGroupOrRoot(executor, 'SIGCONT', {killImpl, platform, liveness});
  }
  for (const identity of descendants) {
    if (!verifiedIdentity(identity) || liveness(identity) !== 'alive') continue;
    try { killImpl(identity.pid, 'SIGCONT'); resumed = true; } catch { /* exited after verification */ }
  }
  return resumed;
};

export const executorTreeAbsent = (executor, descendants, {platform = process.platform, liveness = (identity) => executorLiveness(identity, {platform})} = {}) => {
  if (liveness(executor) !== 'dead') return false;
  return descendants.every((descendant) => liveness(descendant) === 'dead');
};

/**
 * Conservatively stop a verified detached executor.  Descendants are sampled
 * again after each root/group signal and retained as an identity union: once a
 * child is observed, reparenting cannot make us forget to drain it.
 */
export const terminateProcessTree = (executor, {
  killImpl = process.kill,
  waitMs = 1000,
  platform = process.platform,
  commandImpl = command,
} = {}) => {
  const rootState = executorLiveness(executor, {platform});
  if (rootState === 'unknown') return false;
  if (platform === 'win32') {
    const result = commandImpl('taskkill.exe', ['/PID', String(executor.pid), '/T', '/F']);
    if (result.state !== 'ok' || result.status !== 0) return false;
    return executorLiveness(executor, {platform}) === 'dead';
  }
  const snapshot = snapshotExecutorDescendants(executor.pid, {platform, commandImpl});
  if (!snapshot.known) return false;
  let descendants = snapshot.descendants;
  const refresh = () => {
    if (executorLiveness(executor, {platform}) !== 'alive') return;
    const current = snapshotExecutorDescendants(executor.pid, {platform, commandImpl});
    if (current.known) descendants = unionDescendants(descendants, current.descendants);
  };
  const termRootState = executorLiveness(executor, {platform});
  if (termRootState === 'unknown') return false;
  if (termRootState === 'alive' && !signalExecutorGroupOrRoot(executor, 'SIGTERM', {killImpl, platform})) return false;
  refresh();
  signalExecutorTree(executor, descendants, 'SIGTERM', {killImpl, platform});
  const deadline = Date.now() + waitMs;
  const forceAt = Date.now() + Math.floor(waitMs / 2);
  while (Date.now() < forceAt) {
    refresh();
    if (executorTreeAbsent(executor, descendants, {platform})) return true;
  }
  // Kill the group/root before sampling again: this prevents the executor
  // from spawning another detached branch during the KILL handoff.
  if (!signalExecutorGroupOrRoot(executor, 'SIGKILL', {killImpl, platform}) && executorLiveness(executor, {platform}) !== 'dead') return false;
  refresh();
  signalExecutorTree(executor, descendants, 'SIGKILL', {killImpl, platform});
  while (Date.now() < deadline) {
    refresh();
    if (executorTreeAbsent(executor, descendants, {platform})) return true;
  }
  return executorTreeAbsent(executor, descendants, {platform});
};

export const terminateExecutorTree = terminateProcessTree;
