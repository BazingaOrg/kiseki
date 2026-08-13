import fs from 'node:fs';
import path from 'node:path';

export class RootBusyError extends Error {}

export const canonicalizeAuthorizedRoot = (candidate) => {
  if (typeof candidate !== 'string' || candidate.length === 0) throw new TypeError('项目根目录必须是非空路径');
  const resolved = path.resolve(candidate);
  const linkStat = fs.lstatSync(resolved);
  if (!linkStat.isDirectory() || linkStat.isSymbolicLink()) throw new TypeError(`不是可授权的目录: ${resolved}`);
  const canonical = fs.realpathSync(resolved);
  const stat = fs.statSync(canonical);
  return Object.freeze({path: canonical, identity: Object.freeze({dev: String(stat.dev), ino: String(stat.ino)})});
};

const validateSnapshot = (snapshot) => {
  const current = canonicalizeAuthorizedRoot(snapshot.path);
  if (current.identity.dev !== snapshot.identity.dev || current.identity.ino !== snapshot.identity.ino) {
    throw new Error('项目根目录身份已变化');
  }
  return snapshot;
};

export const createImmutableRootController = (root) => {
  const snapshot = Object.freeze({...canonicalizeAuthorizedRoot(root), generation: 0});
  return Object.freeze({mutable: false, getSnapshot: () => validateSnapshot(snapshot)});
};

export const createMutableRootController = ({initialRoot = null} = {}) => {
  let generation = 0;
  let snapshot = initialRoot === null ? null : Object.freeze({...canonicalizeAuthorizedRoot(initialRoot), generation});
  const controller = {
    mutable: true,
    getSnapshot: () => {
      if (snapshot === null) throw new Error('尚未授权项目根目录');
      return validateSnapshot(snapshot);
    },
    setRoot: (candidate) => {
      const next = canonicalizeAuthorizedRoot(candidate);
      return controller.setSnapshot(next);
    },
    setSnapshot: (next) => {
      generation += 1;
      snapshot = Object.freeze({...next, generation});
      return snapshot;
    },
  };
  return Object.freeze(controller);
};

export const createWriteActivityGate = () => {
  let active = 0;
  const waiters = new Set();
  return Object.freeze({
    enter: () => {
      active += 1;
      let released = false;
      return () => {
        if (!released) {
          released = true; active -= 1;
          if (active === 0) { for (const resolve of waiters) resolve(); waiters.clear(); }
        }
      };
    },
    isBusy: () => active > 0,
    waitForIdle: () => active === 0 ? Promise.resolve() : new Promise((resolve) => waiters.add(resolve)),
  });
};
