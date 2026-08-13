import {spawn as spawnActual} from 'node:child_process';

import {
  executorIdentity,
  executorTreeAbsent,
  freezeExecutorTree,
  resumeFrozenExecutorTree,
  signalExecutorGroupOrRoot,
  signalExecutorTree,
  snapshotExecutorDescendants,
} from '../runtime-lifecycle.mjs';

const mergeDescendants = (left, right) => {
  const merged = new Map();
  for (const identity of [...left, ...right]) {
    if (!Number.isInteger(identity?.pid) || identity.pid <= 0 || typeof identity.start !== 'string' || !identity.start) continue;
    merged.set(`${identity.pid}:${identity.start}`, identity);
  }
  return [...merged.values()];
};

const defaultWindowsTerminate = (pid) => new Promise((resolve) => {
  let child;
  try {
    child = spawnActual('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {stdio: 'ignore', windowsHide: true});
  } catch {
    resolve(false);
    return;
  }
  child.once('error', () => resolve(false));
  child.once('close', (code) => resolve(code === 0));
});

const defaultLifecycle = {
  identity: (pid, {platform}) => executorIdentity(pid, {platform}),
  snapshot: (pid, {platform}) => snapshotExecutorDescendants(pid, {platform}),
  signalGroup: (executor, signal, {platform}) => signalExecutorGroupOrRoot(executor, signal, {platform}),
  signalTree: (executor, descendants, signal, {platform}) => signalExecutorTree(executor, descendants, signal, {platform}),
  absent: (executor, descendants, {platform}) => executorTreeAbsent(executor, descendants, {platform}),
  freeze: (executor, {platform}) => freezeExecutorTree(executor, {platform, snapshot: () => snapshotExecutorDescendants(executor.pid, {platform})}),
  resume: (executor, frozen, {platform}) => resumeFrozenExecutorTree(executor, frozen, {platform}),
  terminateWindows: defaultWindowsTerminate,
};

export const createProcessCompletion = ({pid, platform = process.platform, lifecycle = defaultLifecycle, pollMs = 25, settle}) => {
  const executor = lifecycle.identity(pid, {platform});
  let descendants = [];
  let childClosed = false;
  let terminationState = 'idle';
  let absenceConfirmed = false;
  let timer = null;
  let settled = false;

  const finish = () => {
    if (settled || !childClosed || (terminationState === 'ready' && !absenceConfirmed) || terminationState === 'failed') return;
    settled = true;
    if (timer) clearTimeout(timer);
    settle();
  };

  const observe = () => {
    const snapshot = lifecycle.snapshot(executor.pid, {platform});
    if (!snapshot?.known) return false;
    descendants = mergeDescendants(descendants, snapshot.descendants ?? []);
    return true;
  };

  const poll = () => {
    if (settled || terminationState !== 'ready') return;
    if (observe() && lifecycle.absent(executor, descendants, {platform})) {
      absenceConfirmed = true;
      finish();
      return;
    }
    timer = setTimeout(poll, pollMs);
    timer.unref?.();
  };

  const requestTermination = () => {
    if (terminationState !== 'idle' || settled) return;
    terminationState = 'failed';
    if (!Number.isInteger(executor?.pid) || executor.pid <= 0 || typeof executor.start !== 'string' || !executor.start) return;
    if (platform === 'win32') {
      void lifecycle.terminateWindows(executor.pid).then((ok) => {
        if (!ok) return;
        terminationState = 'ready';
        poll();
      }).catch(() => {});
      return;
    }
    const frozen = lifecycle.freeze(executor, {platform});
    if (!frozen?.confirmed) {
      lifecycle.resume?.(executor, frozen?.frozen ?? [], {platform});
      return;
    }
    descendants = mergeDescendants(descendants, frozen.descendants ?? []);
    const groupSignaled = lifecycle.signalGroup(executor, 'SIGKILL', {platform});
    const treeSignaled = lifecycle.signalTree(executor, descendants, 'SIGKILL', {platform});
    if (!groupSignaled && !treeSignaled) {
      lifecycle.resume?.(executor, frozen.frozen ?? [], {platform});
      return;
    }
    terminationState = 'ready';
    poll();
  };

  return {
    close: () => {
      childClosed = true;
      if (terminationState === 'ready') poll();
      return terminationState !== 'idle';
    },
    requestTermination,
  };
};
