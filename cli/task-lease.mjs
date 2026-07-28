/** Durable, per-user task ownership for web jobs. */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {outputArtifactPaths} from './atomic-output.mjs';
import {executorIdentity, executorLiveness, terminateProcessTree} from './runtime-lifecycle.mjs';

export class ProjectBusyError extends Error {
  constructor() { super('项目已有任务在执行'); this.name = 'ProjectBusyError'; }
}

const modeIsPrivate = (stat) => (stat.mode & 0o022) === 0;
const assertPrivateOwnedDirectory = (dir) => {
  const stat = fs.lstatSync(dir);
  if (!stat.isDirectory() || stat.isSymbolicLink() || !modeIsPrivate(stat)) throw new Error('runtime registry 权限异常');
  // uid is not available on Windows; where it is, never operate on another user's registry.
  if (typeof process.getuid === 'function' && typeof stat.uid === 'number' && stat.uid !== process.getuid()) {
    throw new Error('runtime registry 所有者异常');
  }
};

export const resolveRuntimeRegistry = ({platform = process.platform, env = process.env, home = os.homedir()} = {}) => {
  if (platform === 'darwin') return path.join(home, 'Library', 'Caches', 'tsuzuri', 'runtime', 'v1');
  if (platform === 'win32') return path.join(env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'tsuzuri', 'runtime', 'v1');
  const runtime = env.XDG_RUNTIME_DIR;
  if (runtime) {
    try { assertPrivateOwnedDirectory(runtime); return path.join(runtime, 'tsuzuri', 'runtime', 'v1'); } catch { /* use durable user state */ }
  }
  return path.join(env.XDG_STATE_HOME || path.join(home, '.local', 'state'), 'tsuzuri', 'runtime', 'v1');
};

const makePrivateDir = (dir) => {
  fs.mkdirSync(dir, {recursive: true, mode: 0o700});
  fs.chmodSync(dir, 0o700);
  assertPrivateOwnedDirectory(dir);
};
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const normalizeIdentity = (resource, platform = process.platform) => {
  const normalized = path.normalize(resource);
  return platform === 'win32' ? normalized.replaceAll('\\', '/').toLowerCase() : normalized;
};
/**
 * Keep an output's final filename literal while resolving only its parent.
 * Resolving an existing final symlink would redirect the atomic artifacts to
 * an unrelated target, so final symlinks are not valid output destinations.
 */
export const artifactPath = (output) => {
  const resolved = path.resolve(output);
  let final;
  try { final = fs.lstatSync(resolved); }
  catch (error) { if (error?.code !== 'ENOENT') throw error; }
  if (final?.isSymbolicLink()) throw new Error('输出目标不能是符号链接');
  const missingParents = [];
  let parent = path.dirname(resolved);
  for (;;) {
    try {
      if (!fs.statSync(parent).isDirectory()) throw new Error('输出父路径不是目录');
      return path.join(fs.realpathSync.native(parent), ...missingParents.reverse(), path.basename(resolved));
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      const next = path.dirname(parent);
      if (next === parent) throw error;
      missingParents.push(path.basename(parent));
      parent = next;
    }
  }
};
/** The registry key may be stricter than the real artifact pathname. */
export const claimIdentity = (resource, {platform = process.platform} = {}) => {
  const normalized = path.normalize(resource);
  if (platform !== 'win32' && platform !== 'darwin') return normalized;
  const unresolvedTail = [];
  let cursor = path.resolve(normalized);
  for (;;) {
    try {
      const stat = fs.lstatSync(cursor);
      if (stat.isSymbolicLink()) throw new Error('资源不能是符号链接');
      if (!stat.isDirectory() && unresolvedTail.length > 0) throw new Error('资源父路径不是目录');
      const physicalPrefix = fs.realpathSync.native(cursor);
      return path.join(
        physicalPrefix,
        ...unresolvedTail.reverse().map((part) => part.normalize('NFC').toLowerCase()),
      );
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      const parent = path.dirname(cursor);
      if (parent === cursor) throw error;
      unresolvedTail.push(path.basename(cursor));
      cursor = parent;
    }
  }
};
/** A resource is identified by its physical existing prefix, never a spelling. */
export const canonicalResourceIdentity = (resource, {platform = process.platform} = {}) => {
  const resolved = path.resolve(resource);
  const missingTail = [];
  let cursor = resolved;
  for (;;) {
    try {
      const stat = fs.lstatSync(cursor);
      if (!stat.isDirectory() && missingTail.length > 0) throw new Error('资源父路径不是目录');
      const parent = fs.realpathSync.native(cursor);
      return normalizeIdentity(path.join(parent, ...missingTail.reverse()), platform);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      const parent = path.dirname(cursor);
      if (parent === cursor) throw error;
      missingTail.push(path.basename(cursor));
      cursor = parent;
    }
  }
};
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const writeJson = (file, value) => fs.writeFileSync(file, JSON.stringify(value), {mode: 0o600, flag: 'wx'});
const replaceJson = (file, value) => {
  const dir = path.dirname(file);
  const temp = path.join(dir, `.${path.basename(file)}.${crypto.randomUUID()}.tmp`);
  let fd;
  try {
    fd = fs.openSync(temp, 'wx', 0o600);
    fs.writeFileSync(fd, JSON.stringify(value));
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;
    fs.renameSync(temp, file);
    // Make the rename durable where the platform permits directory fsync.
    let dirFd;
    try {
      dirFd = fs.openSync(dir, 'r');
      fs.fsyncSync(dirFd);
    } catch { /* Windows does not support this. */ }
    finally { if (dirFd !== undefined) try { fs.closeSync(dirFd); } catch { /* best effort */ } }
  } catch (error) {
    if (fd !== undefined && fd !== null) try { fs.closeSync(fd); } catch { /* best effort */ }
    try { fs.rmSync(temp, {force: true}); } catch { /* best effort */ }
    throw error;
  }
};
const sameExecutor = (left, right) => Boolean(left && right && left.pid === right.pid && left.start === right.start);

/**
 * @param {{registryRoot?: string, terminateExecutor?: Function, executorLiveness?: Function}} deps
 */
export const createTaskLeaseManager = ({
  registryRoot = resolveRuntimeRegistry(),
  terminateExecutor = terminateProcessTree,
  executorLiveness: liveness = executorLiveness,
  platform = process.platform,
} = {}) => {
  makePrivateDir(registryRoot);
  const tasksDir = path.join(registryRoot, 'tasks');
  const claimsDir = path.join(registryRoot, 'claims');
  makePrivateDir(tasksDir);
  makePrivateDir(claimsDir);

  const canonical = (resource) => canonicalResourceIdentity(resource, {platform});
  const artifact = (output) => artifactPath(output);
  const claimFile = (resource) => path.join(claimsDir, `${hash(claimIdentity(resource, {platform}))}.json`);
  const removeTask = (taskRoot) => {
    const expected = path.join(tasksDir, path.basename(taskRoot));
    if (taskRoot !== expected) throw new Error('taskRoot 越界');
    fs.rmSync(taskRoot, {recursive: true, force: true});
  };
  const failClosed = () => { throw new ProjectBusyError(); };
  const manifestResources = (manifest) => {
    if (!manifest || typeof manifest.id !== 'string' || manifest.taskRoot !== path.join(tasksDir, manifest.id) || !Array.isArray(manifest.resources)) failClosed();
    const resources = manifest.resources.map((resource) => {
      if (typeof resource !== 'string' || !path.isAbsolute(resource) || canonical(resource) !== resource) failClosed();
      return resource;
    });
    if (new Set(resources).size !== resources.length) failClosed();
    return resources;
  };
  const pendingClaims = (manifest) => {
    if (manifest.pendingClaims === undefined || manifest.pendingClaims === null) return [];
    if (!Array.isArray(manifest.pendingClaims)) failClosed();
    const pending = manifest.pendingClaims.map((resource) => {
      if (typeof resource !== 'string' || !path.isAbsolute(resource) || canonical(resource) !== resource) failClosed();
      return resource;
    });
    if (new Set(pending).size !== pending.length || pending.some((resource) => manifest.resources.includes(resource))) failClosed();
    return pending;
  };
  const pendingOutputs = (manifest) => {
    if (manifest.pendingOutputClaims === undefined || manifest.pendingOutputClaims === null) return [];
    if (!Array.isArray(manifest.pendingOutputClaims)) failClosed();
    const pending = manifest.pendingOutputClaims.map((output) => {
      if (typeof output !== 'string' || !path.isAbsolute(output) || artifact(output) !== output) failClosed();
      return output;
    });
    if (new Set(pending).size !== pending.length || pending.some((output) => manifest.resources.includes(output))) failClosed();
    return pending;
  };
  const outputClaims = (manifest) => {
    const resources = manifestResources(manifest);
    if (!Array.isArray(manifest.outputPaths)) failClosed();
    const outputs = manifest.outputPaths.map((output) => {
      if (typeof output !== 'string' || !path.isAbsolute(output) || artifact(output) !== output) failClosed();
      return output;
    });
    const pending = pendingClaims(manifest);
    if (new Set(outputs).size !== outputs.length || outputs.some((output) => !resources.includes(output) && !pending.includes(output))) failClosed();
    return outputs;
  };
  const regularFileOrMissing = (file) => {
    try {
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink()) failClosed();
      return true;
    } catch (error) {
      if (error instanceof ProjectBusyError) throw error;
      if (error?.code === 'ENOENT') return false;
      failClosed();
    }
  };
  const outputTransaction = (manifest) => {
    if (manifest.outputTransaction === undefined || manifest.outputTransaction === null) return null;
    const transaction = manifest.outputTransaction;
    if (!transaction || transaction.taskId !== manifest.id || !['prepared', 'committing', 'committed'].includes(transaction.phase) || !Array.isArray(transaction.paths) || transaction.paths.length === 0) failClosed();
    const outputs = outputClaims(manifest);
    const resources = manifestResources(manifest);
    const paths = transaction.paths.map((entry) => {
      if (!entry || typeof entry.path !== 'string' || !path.isAbsolute(entry.path) || artifact(entry.path) !== entry.path || typeof entry.hadFinal !== 'boolean' || typeof entry.delete !== 'boolean') failClosed();
      if (!outputs.includes(entry.path) || !resources.includes(entry.path)) failClosed();
      const artifacts = outputArtifactPaths(entry.path, manifest.id);
      if (artifacts.finalPath !== entry.path) failClosed();
      return {...entry, ...artifacts};
    });
    if (new Set(paths.map((entry) => entry.path)).size !== paths.length || paths.some((entry, index) => index > 0 && paths[index - 1].path.localeCompare(entry.path) >= 0)) failClosed();
    return {...transaction, paths};
  };
  const verifyTransactionClaims = (manifest, transaction) => {
    for (const entry of transaction.paths) {
      let claim;
      try { claim = readJson(claimFile(entry.path)); } catch { failClosed(); }
      if (claim.taskId !== manifest.id || claim.resource !== entry.path) failClosed();
    }
  };
  const cleanupOutputTransaction = (manifest) => {
    const transaction = outputTransaction(manifest);
    if (!transaction) return false;
    verifyTransactionClaims(manifest, transaction);
    const states = transaction.paths.map((entry) => ({
      ...entry,
      hasFinal: regularFileOrMissing(entry.finalPath),
      hasPartial: regularFileOrMissing(entry.partialPath),
      hasBackup: regularFileOrMissing(entry.backupPath),
    }));
    if (transaction.phase === 'committed') {
      for (const entry of states) {
        if (entry.delete ? entry.hasFinal : !entry.hasFinal) failClosed();
        if (!entry.hadFinal && entry.hasBackup) failClosed();
      }
      for (const entry of states) {
        if (entry.hasPartial) fs.rmSync(entry.partialPath);
        if (entry.hasBackup) fs.rmSync(entry.backupPath);
      }
      return true;
    }
    // prepared and committing always restore the pre-transaction set as one unit.
    for (const entry of states) {
      if (entry.hadFinal) {
        if (!entry.hasFinal && !entry.hasBackup) failClosed();
      } else if (entry.hasBackup) failClosed();
    }
    for (const entry of states) {
      if (entry.hadFinal) {
        if (entry.hasBackup) {
          if (entry.hasFinal) fs.rmSync(entry.finalPath);
          fs.renameSync(entry.backupPath, entry.finalPath);
        }
      } else if (entry.hasFinal) fs.rmSync(entry.finalPath);
      if (entry.hasPartial) fs.rmSync(entry.partialPath);
    }
    return true;
  };
  const cleanupOutputArtifacts = (manifest, {requireClaims = true} = {}) => {
    if (outputTransaction(manifest)) {
      if (!requireClaims) failClosed();
      cleanupOutputTransaction(manifest);
      return;
    }
    const resources = manifestResources(manifest);
    for (const output of outputClaims(manifest).filter((output) => resources.includes(output))) {
      if (requireClaims) {
        let claim;
        try { claim = readJson(claimFile(output)); } catch { failClosed(); }
        if (claim.taskId !== manifest.id || claim.resource !== output) failClosed();
      }
      const {finalPath, partialPath, backupPath} = outputArtifactPaths(output, manifest.id);
      if (finalPath !== output) failClosed();
      const hasFinal = regularFileOrMissing(finalPath);
      const hasPartial = regularFileOrMissing(partialPath);
      const hasBackup = regularFileOrMissing(backupPath);
      if (hasPartial) fs.rmSync(partialPath);
      if (hasBackup) {
        if (hasFinal) fs.rmSync(backupPath);
        else fs.renameSync(backupPath, finalPath);
      }
    }
  };
  const releaseManifest = (manifest, {requireOutputClaims = true, requireResourceClaims = true} = {}) => {
    const resources = manifestResources(manifest);
    const pendingClaimsForManifest = pendingClaims(manifest);
    const pending = pendingOutputs(manifest);
    cleanupOutputArtifacts(manifest, {requireClaims: requireOutputClaims});
    for (const resource of resources) {
      const file = claimFile(resource);
      if (!requireResourceClaims) {
        try {
          if (readJson(file).taskId === manifest.id) fs.rmSync(file, {force: true});
        } catch { /* failed acquisition has no executor or output to recover */ }
        continue;
      }
      let claim;
      try { claim = readJson(file); } catch { failClosed(); }
      if (claim.taskId !== manifest.id || claim.resource !== resource) failClosed();
      fs.rmSync(file);
    }
    for (const resource of pending) {
      const file = claimFile(resource);
      try {
        const claim = readJson(file);
        if (claim.taskId === manifest.id && claim.resource === resource) fs.rmSync(file, {force: true});
      } catch (error) {
        if (error?.code !== 'ENOENT') failClosed();
      }
    }
    for (const resource of pendingClaimsForManifest) {
      const file = claimFile(resource);
      try {
        const claim = readJson(file);
        if (claim.taskId === manifest.id && claim.resource === resource) fs.rmSync(file, {force: true});
      } catch (error) {
        // A crash can occur before any particular pending claim is created.
        // That absence is expected; malformed claims remain fail closed.
        if (error?.code !== 'ENOENT') failClosed();
      }
    }
    removeTask(manifest.taskRoot);
  };
  const recoverClaim = (file) => {
    let claim;
    try { claim = readJson(file); } catch { throw new ProjectBusyError(); }
    if (!claim || typeof claim.taskId !== 'string' || typeof claim.resource !== 'string') throw new ProjectBusyError();
    const taskRoot = path.join(tasksDir, claim.taskId);
    let manifest;
    try { manifest = readJson(path.join(taskRoot, 'manifest.json')); } catch { throw new ProjectBusyError(); }
    if (manifest.id !== claim.taskId || manifest.taskRoot !== taskRoot) throw new ProjectBusyError();
    let resources;
    let pending;
    let pendingOutputsForManifest;
    try {
      resources = manifestResources(manifest);
      pending = pendingClaims(manifest);
      pendingOutputsForManifest = pendingOutputs(manifest);
      outputClaims(manifest);
    } catch { throw new ProjectBusyError(); }
    const knownClaims = [
      ...resources,
      ...pending,
      ...pendingOutputsForManifest,
    ];
    if (!knownClaims.includes(claim.resource) || claimFile(claim.resource) !== file) throw new ProjectBusyError();
    // Only a confirmed dead owner can be recovered; unknown liveness stays busy.
    if (!manifest.owner || liveness(manifest.owner) !== 'dead') throw new ProjectBusyError();
    if (manifest.executor) {
      const stopped = terminateExecutor(manifest.executor);
      if (stopped && typeof stopped.then === 'function') throw new ProjectBusyError();
      if (!stopped || liveness(manifest.executor) !== 'dead') throw new ProjectBusyError();
    }
    releaseManifest(manifest);
  };

  const acquire = ({resources, outputPaths = [], kind = null}) => {
    const canonicalOutputs = [...new Set(outputPaths.map(artifact))].sort();
    const unique = [...new Set([...(resources ?? []).map(canonical), ...canonicalOutputs])].sort();
    if (unique.length === 0) throw new Error('任务缺少资源 claim');
    const id = crypto.randomUUID();
    const taskRoot = path.join(tasksDir, id);
    const token = crypto.randomBytes(32).toString('hex');
    const manifest = {
      id, taskRoot, resources: [], outputPaths: canonicalOutputs, pendingClaims: unique, tokenHash: hash(token),
      owner: executorIdentity(process.pid), platform: process.platform, kind,
      spawnIntent: false, executor: null, pendingOutputClaims: null,
    };
    makePrivateDir(taskRoot);
    try {
      writeJson(path.join(taskRoot, 'manifest.json'), manifest);
      for (const resource of unique) {
        const file = claimFile(resource);
        try { writeJson(file, {taskId: id, resource}); }
        catch (error) {
          if (error?.code !== 'EEXIST') throw error;
          recoverClaim(file);
          writeJson(file, {taskId: id, resource});
        }
      }
      replaceJson(path.join(taskRoot, 'manifest.json'), {...manifest, resources: unique, pendingClaims: null});
    } catch (error) {
      releaseManifest(manifest, {requireOutputClaims: false, requireResourceClaims: false});
      if (error instanceof ProjectBusyError) throw error;
      throw error;
    }
    return {id, token, taskRoot, resources: unique};
  };
  const update = (lease, patch) => {
    const file = path.join(lease.taskRoot, 'manifest.json');
    const manifest = readJson(file);
    if (manifest.id !== lease.id || manifest.tokenHash !== hash(lease.token)) throw new Error('task ownership 无效');
    replaceJson(file, {...manifest, ...patch});
  };
  /** Atomically add sorted output/resource claims while the authenticated owner holds the lease. */
  const extendOutputClaims = (lease, outputPaths) => {
    const file = path.join(lease.taskRoot, 'manifest.json');
    const manifest = readJson(file);
    if (manifest.id !== lease.id || manifest.tokenHash !== hash(lease.token)) throw new Error('task ownership 无效');
    const additions = [...new Set((outputPaths ?? []).map(artifact))]
      .filter((output) => !manifest.outputPaths.includes(output)).sort();
    // First persist intent. If this process dies after a claim is created,
    // stale recovery sees it here and removes only this transaction's claims.
    update(lease, {pendingOutputClaims: additions});
    try {
      for (const output of additions) {
        const claim = claimFile(output);
        try { writeJson(claim, {taskId: lease.id, resource: output}); }
        catch (error) {
          if (error?.code !== 'EEXIST') throw error;
          recoverClaim(claim);
          writeJson(claim, {taskId: lease.id, resource: output});
        }
      }
      update(lease, {
        resources: [...new Set([...manifest.resources, ...additions])].sort(),
        outputPaths: [...new Set([...manifest.outputPaths, ...additions])].sort(),
        pendingOutputClaims: null,
      });
      return additions;
    } catch (error) {
      for (const output of additions) {
        try {
          const claim = readJson(claimFile(output));
          if (claim.taskId === lease.id && claim.resource === output) fs.rmSync(claimFile(output), {force: true});
        } catch { /* Fail closed on the original error. */ }
      }
      try { update(lease, {pendingOutputClaims: null}); } catch { /* original error wins */ }
      throw error;
    }
  };
  const prepareOutputTransaction = (lease, entries) => {
    const manifest = readJson(path.join(lease.taskRoot, 'manifest.json'));
    if (manifest.id !== lease.id || manifest.tokenHash !== hash(lease.token) || outputTransaction(manifest)) throw new Error('task output transaction 无效');
    const outputs = outputClaims(manifest);
    const paths = entries.map((entry) => {
      const finalPath = artifact(entry.finalPath);
      if (!outputs.includes(finalPath) || !manifest.resources.includes(finalPath)) throw new Error('task lease 未认领安装输出');
      return {path: finalPath, hadFinal: regularFileOrMissing(finalPath), delete: Boolean(entry.delete)};
    }).sort((left, right) => left.path.localeCompare(right.path));
    if (paths.length === 0 || new Set(paths.map((entry) => entry.path)).size !== paths.length) throw new Error('原子安装包含重复目标');
    update(lease, {outputTransaction: {taskId: lease.id, phase: 'prepared', paths}});
  };
  const setOutputTransactionPhase = (lease, phase) => {
    const manifest = readJson(path.join(lease.taskRoot, 'manifest.json'));
    if (manifest.id !== lease.id || manifest.tokenHash !== hash(lease.token)) throw new Error('task ownership 无效');
    const transaction = outputTransaction(manifest);
    if (!transaction || (phase === 'committing' && transaction.phase !== 'prepared') || (phase === 'committed' && transaction.phase !== 'committing')) throw new Error('task output transaction 阶段无效');
    update(lease, {outputTransaction: {...manifest.outputTransaction, phase}});
  };
  const rollbackOutputTransaction = (lease) => {
    const manifest = readJson(path.join(lease.taskRoot, 'manifest.json'));
    if (manifest.id !== lease.id || manifest.tokenHash !== hash(lease.token)) throw new Error('task ownership 无效');
    const transaction = outputTransaction(manifest);
    if (!transaction) return;
    if (transaction.phase === 'committed') throw new Error('已提交事务不可回滚');
    cleanupOutputTransaction(manifest);
    update(lease, {outputTransaction: null});
  };
  const finalizeOutputTransaction = (lease) => {
    const manifest = readJson(path.join(lease.taskRoot, 'manifest.json'));
    if (manifest.id !== lease.id || manifest.tokenHash !== hash(lease.token)) throw new Error('task ownership 无效');
    const transaction = outputTransaction(manifest);
    if (!transaction || transaction.phase !== 'committed') throw new Error('task output transaction 未提交');
    cleanupOutputTransaction(manifest);
    update(lease, {outputTransaction: null});
  };
  const markSpawnIntent = (lease) => update(lease, {spawnIntent: true});
  const registerExecutor = (lease, executor) => {
    const manifest = readJson(path.join(lease.taskRoot, 'manifest.json'));
    if (manifest.id !== lease.id || manifest.tokenHash !== hash(lease.token)) throw new Error('task ownership 无效');
    manifestResources(manifest);
    outputClaims(manifest);
    if (!executor || !Number.isInteger(executor.pid) || executor.pid <= 0 || (executor.start !== null && (typeof executor.start !== 'string' || !executor.start))) {
      throw new Error('task executor identity 无效');
    }
    if (manifest.executor) {
      if (!Number.isInteger(manifest.executor.pid) || manifest.executor.pid <= 0 || typeof manifest.executor.start !== 'string' || !manifest.executor.start) {
        throw new Error('task executor identity 无效');
      }
      // The child can durably authenticate and self-register before its parent
      // gets a reliable start-time probe. Its recorded identity is canonical.
      if (manifest.executor.pid !== executor.pid || (executor.start && manifest.executor.start !== executor.start)) {
        throw new Error('task executor identity 不匹配');
      }
      return manifest.executor;
    }
    const canonicalExecutor = executorIdentity(executor.pid);
    if (!canonicalExecutor.start || (executor.start && !sameExecutor(canonicalExecutor, executor))) {
      throw new Error('task executor identity 不匹配');
    }
    if (!manifest.spawnIntent || !sameExecutor(manifest.owner, executorIdentity(process.pid))) throw new Error('task executor 所有者异常');
    update(lease, {executor: canonicalExecutor, spawnIntent: false});
    return canonicalExecutor;
  };
  const release = (lease) => {
    try {
      const manifest = readJson(path.join(lease.taskRoot, 'manifest.json'));
      if (manifest.id !== lease.id || manifest.tokenHash !== hash(lease.token)) return false;
      releaseManifest(manifest);
      return true;
    } catch { return false; }
  };
  const attachInheritedLease = ({id = process.env.TSUZURI_LEASE_TASK_ID, token = process.env.TSUZURI_LEASE_TASK_TOKEN, taskRoot = process.env.TSUZURI_LEASE_TASK_ROOT, expectedFolder, expectedOutputPaths = [], allowedParentKinds = []} = {}) => {
    if (!id && !token && !taskRoot) return null;
    if (!id || !token || !taskRoot) throw new Error('task lease 环境不完整');
    const expectedRoot = path.join(tasksDir, id);
    if (taskRoot !== expectedRoot) throw new Error('taskRoot 越界');
    const manifest = readJson(path.join(taskRoot, 'manifest.json'));
    if (manifest.id !== id || manifest.taskRoot !== taskRoot || manifest.tokenHash !== hash(token)) throw new Error('task ownership 无效');
    const resources = manifestResources(manifest);
    const outputs = outputClaims(manifest);
    pendingOutputs(manifest);
    if (!expectedFolder || !manifest.resources?.includes(canonical(expectedFolder))) throw new Error('task lease 与命令不匹配');
    if ([...new Set(expectedOutputPaths.map(artifact))].some((output) => !outputs.includes(output))) {
      throw new Error('task lease 未认领命令输出');
    }
    if (!allowedParentKinds.includes(manifest.kind)) throw new Error('task lease 父任务不匹配');
    const self = executorIdentity(process.pid);
    if (!manifest.executor && manifest.spawnIntent) {
      // A spawned CLI can begin before its parent records child.pid.  It owns
      // the same authenticated lease and may durably record exactly itself.
      if (!self.start) throw new Error('task executor identity 无效');
      replaceJson(path.join(taskRoot, 'manifest.json'), {...manifest, executor: self, spawnIntent: false});
    } else if (!sameExecutor(manifest.executor, self)) throw new Error('task executor 所有者异常');
    for (const resource of resources) {
      const claim = readJson(claimFile(resource));
      if (claim.taskId !== id || claim.resource !== resource) throw new Error('task lease claim 无效');
    }
    return {id, token, taskRoot, resources, inherited: true};
  };
  const inherit = ({kind, folder, ...args} = {}) => attachInheritedLease({expectedFolder: folder, allowedParentKinds: kind ? [kind] : [], ...args});
  return {acquire, extendOutputClaims, prepareOutputTransaction, setOutputTransactionPhase, rollbackOutputTransaction, finalizeOutputTransaction, markSpawnIntent, registerExecutor, release, inherit, attachInheritedLease, registryRoot};
};

/** Acquire for direct CLIs, or validate the parent web-job lease before writes. */
export const acquireCommandLease = ({kind, folder, outputPaths = [], manager = createTaskLeaseManager(), env = process.env} = {}) => {
  const inherited = manager.attachInheritedLease({expectedFolder: folder, expectedOutputPaths: outputPaths, allowedParentKinds: [kind], id: env.TSUZURI_LEASE_TASK_ID, token: env.TSUZURI_LEASE_TASK_TOKEN, taskRoot: env.TSUZURI_LEASE_TASK_ROOT});
  const lease = inherited ?? manager.acquire({kind, resources: [folder], outputPaths});
  const tempDir = path.join(lease.taskRoot, 'tmp');
  makePrivateDir(tempDir);
  // Direct CLIs do not otherwise receive the Web lease environment. Keep the
  // task id available to same-process render children so their artifacts remain
  // derivable from this lease's output claims.
  return {lease, manager, inherited: Boolean(inherited), env: {TSUZURI_LEASE_TASK_ID: lease.id, TSUZURI_LEASE_TASK_TOKEN: lease.token, TSUZURI_LEASE_TASK_ROOT: lease.taskRoot, TMPDIR: tempDir, TMP: tempDir, TEMP: tempDir}};
};
