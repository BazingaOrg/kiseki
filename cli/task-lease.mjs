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
  if (platform === 'darwin') return path.join(home, 'Library', 'Caches', 'kiseki', 'runtime', 'v1');
  if (platform === 'win32') return path.join(env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'kiseki', 'runtime', 'v1');
  const runtime = env.XDG_RUNTIME_DIR;
  if (runtime) {
    try { assertPrivateOwnedDirectory(runtime); return path.join(runtime, 'kiseki', 'runtime', 'v1'); } catch { /* use durable user state */ }
  }
  return path.join(env.XDG_STATE_HOME || path.join(home, '.local', 'state'), 'kiseki', 'runtime', 'v1');
};

const makePrivateDir = (dir) => {
  fs.mkdirSync(dir, {recursive: true, mode: 0o700});
  fs.chmodSync(dir, 0o700);
  assertPrivateOwnedDirectory(dir);
};
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
/** A claim key is lexical: it must never depend on what exists on disk. */
export const stableClaimKey = (resource, {platform = process.platform} = {}) => {
  const absolute = path.resolve(resource);
  if (platform !== 'darwin' && platform !== 'win32') return path.normalize(absolute);
  const normalized = platform === 'win32' ? path.win32.normalize(absolute).replaceAll('\\', '/') : path.normalize(absolute);
  return normalized.normalize('NFC').toLowerCase();
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
  if (final && (!final.isFile() || final.isSymbolicLink())) throw new Error('输出目标必须是普通文件');
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
  return stableClaimKey(resource, {platform});
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
      return path.join(parent, ...missingTail.reverse());
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
  const claimKey = (resource) => stableClaimKey(resource, {platform});
  const artifact = (output) => artifactPath(output);
  const claimFile = (resource) => path.join(claimsDir, `${hash(claimKey(resource))}.json`);
  const removeTask = (taskRoot) => {
    const expected = path.join(tasksDir, path.basename(taskRoot));
    if (taskRoot !== expected) throw new Error('taskRoot 越界');
    fs.rmSync(taskRoot, {recursive: true, force: true});
  };
  const failClosed = () => { throw new ProjectBusyError(); };
  const claimMatches = (claim, taskId, resource, version = 2) => version === 2
    ? Boolean(claim && claim.identityVersion === 2 && claim.taskId === taskId && typeof claim.resourcePath === 'string' && claim.claimKey === claimKey(resource) && claimKey(claim.resourcePath) === claim.claimKey)
    : Boolean(claim && claim.taskId === taskId && typeof claim.resource === 'string' && claimKey(claim.resource) === claimKey(resource));
  const writeClaim = (file, taskId, resource, tokenHash) => writeJson(file, {
    identityVersion: 2, taskId, tokenHash, resourcePath: resource, claimKey: claimKey(resource),
  });
  const manifestResources = (manifest) => {
    if (!manifest || typeof manifest.id !== 'string' || manifest.taskRoot !== path.join(tasksDir, manifest.id) || !Array.isArray(manifest.resources)) failClosed();
    const resources = manifest.resources.map((resource) => {
      if (typeof resource !== 'string' || !path.isAbsolute(resource)) failClosed();
      if (claimKey(canonical(resource)) !== claimKey(resource)) failClosed();
      return resource;
    });
    if (new Set(resources.map(claimKey)).size !== resources.length) failClosed();
    if (manifest.identityVersion === 2) {
      if (!Array.isArray(manifest.claimKeys) || manifest.claimKeys.length !== resources.length || manifest.claimKeys.some((key, index) => typeof key !== 'string' || key !== claimKey(resources[index]))) failClosed();
    } else if (manifest.identityVersion !== undefined && manifest.identityVersion !== 1) failClosed();
    return resources;
  };
  const manifestClaimFile = (manifest, resource) => {
    if (manifest.identityVersion === 2) return claimFile(resource);
    const matches = fs.readdirSync(claimsDir).filter((name) => name.endsWith('.json')).filter((name) => {
      try {
        const claim = readJson(path.join(claimsDir, name));
        return claim?.identityVersion !== 2 && claim.taskId === manifest.id
          && typeof claim.resource === 'string' && claimKey(claim.resource) === claimKey(resource);
      } catch { failClosed(); }
    });
    if (matches.length !== 1) failClosed();
    return path.join(claimsDir, matches[0]);
  };
  const pendingClaims = (manifest) => {
    if (manifest.pendingClaims === undefined || manifest.pendingClaims === null) return [];
    if (!Array.isArray(manifest.pendingClaims)) failClosed();
    const pending = manifest.pendingClaims.map((resource) => {
      if (typeof resource !== 'string' || !path.isAbsolute(resource)) failClosed();
      if (claimKey(canonical(resource)) !== claimKey(resource)) failClosed();
      return resource;
    });
    if (new Set(pending.map(claimKey)).size !== pending.length || pending.some((resource) => manifest.resources.some((owned) => claimKey(owned) === claimKey(resource)))) failClosed();
    if (manifest.identityVersion === 2 && (!Array.isArray(manifest.pendingClaimKeys) || manifest.pendingClaimKeys.length !== pending.length || manifest.pendingClaimKeys.some((key, index) => typeof key !== 'string' || key !== claimKey(pending[index])))) failClosed();
    return pending;
  };
  const pendingOutputs = (manifest) => {
    if (manifest.pendingOutputClaims === undefined || manifest.pendingOutputClaims === null) return [];
    if (!Array.isArray(manifest.pendingOutputClaims)) failClosed();
    const pending = manifest.pendingOutputClaims.map((output) => {
      if (typeof output !== 'string' || !path.isAbsolute(output)) failClosed();
      if (claimKey(artifact(output)) !== claimKey(output)) failClosed();
      return output;
    });
    if (new Set(pending.map(claimKey)).size !== pending.length || pending.some((output) => manifest.resources.some((owned) => claimKey(owned) === claimKey(output)))) failClosed();
    if (manifest.identityVersion === 2 && (!Array.isArray(manifest.pendingClaimKeys) || manifest.pendingClaimKeys.length !== pending.length || manifest.pendingClaimKeys.some((key, index) => typeof key !== 'string' || key !== claimKey(pending[index])))) failClosed();
    return pending;
  };
  const outputClaims = (manifest) => {
    const resources = manifestResources(manifest);
    if (!Array.isArray(manifest.outputPaths)) failClosed();
    const outputs = manifest.outputPaths.map((output) => {
      if (typeof output !== 'string' || !path.isAbsolute(output)) failClosed();
      if (claimKey(artifact(output)) !== claimKey(output)) failClosed();
      return output;
    });
    const pending = pendingClaims(manifest);
    if (new Set(outputs.map(claimKey)).size !== outputs.length || outputs.some((output) => !resources.some((resource) => claimKey(resource) === claimKey(output)) && !pending.some((resource) => claimKey(resource) === claimKey(output)))) failClosed();
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
      if (!entry || typeof entry.path !== 'string' || !path.isAbsolute(entry.path) || typeof entry.hadFinal !== 'boolean' || typeof entry.delete !== 'boolean') failClosed();
      if (!outputs.some((output) => claimKey(output) === claimKey(entry.path)) || !resources.some((resource) => claimKey(resource) === claimKey(entry.path))) failClosed();
      const artifacts = outputArtifactPaths(entry.path, manifest.id);
      if (artifacts.finalPath !== entry.path) failClosed();
      return {...entry, ...artifacts};
    });
    if (new Set(paths.map((entry) => claimKey(entry.path))).size !== paths.length || paths.some((entry, index) => index > 0 && paths[index - 1].path.localeCompare(entry.path) >= 0)) failClosed();
    return {...transaction, paths};
  };
  const verifyTransactionClaims = (manifest, transaction) => {
    for (const entry of transaction.paths) {
      let claim;
      try { claim = readJson(manifestClaimFile(manifest, entry.path)); } catch { failClosed(); }
      if (!claimMatches(claim, manifest.id, entry.path, manifest.identityVersion ?? 1)) failClosed();
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
    // Prepared is only a durable intent marker: no final/backup rename may
    // have happened yet.  Preserve every current final (including an external
    // write) and reject any backup as evidence of an impossible transition.
    if (transaction.phase === 'prepared') {
      for (const entry of states) if (entry.hasBackup) failClosed();
      for (const entry of states) if (entry.hasPartial) fs.rmSync(entry.partialPath);
      return true;
    }
    // Committing may have moved finals, so restore the captured pre-state.
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
    for (const output of outputClaims(manifest).filter((output) => resources.some((resource) => claimKey(resource) === claimKey(output)))) {
      if (requireClaims) {
        let claim;
        try { claim = readJson(manifestClaimFile(manifest, output)); } catch { failClosed(); }
        if (!claimMatches(claim, manifest.id, output, manifest.identityVersion ?? 1)) failClosed();
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
    // Validate every durable required claim before touching artifacts or
    // deleting a single claim; a corrupt later entry must not half-release.
    const durableResources = [...resources, ...pending, ...pendingClaimsForManifest];
    if (new Set(durableResources.map(claimKey)).size !== durableResources.length) failClosed();
    const requiredClaimFiles = requireResourceClaims ? durableResources.map((resource) => ({resource, file: manifestClaimFile(manifest, resource)})) : [];
    for (const {resource, file} of requiredClaimFiles) {
      let claim;
      try { claim = readJson(file); } catch { failClosed(); }
      if (!claimMatches(claim, manifest.id, resource, manifest.identityVersion ?? 1)) failClosed();
    }
    cleanupOutputArtifacts(manifest, {requireClaims: requireOutputClaims});
    for (const resource of resources) {
      const file = requireResourceClaims ? requiredClaimFiles.find((entry) => claimKey(entry.resource) === claimKey(resource)).file : manifestClaimFile(manifest, resource);
      if (!requireResourceClaims) {
        try {
          if (readJson(file).taskId === manifest.id) fs.rmSync(file, {force: true});
        } catch { /* failed acquisition has no executor or output to recover */ }
        continue;
      }
      fs.rmSync(file);
    }
    for (const resource of pending) {
      const file = manifestClaimFile(manifest, resource);
      try {
        const claim = readJson(file);
        if (claimMatches(claim, manifest.id, resource, manifest.identityVersion ?? 1)) fs.rmSync(file, {force: true});
      } catch (error) {
        if (error?.code !== 'ENOENT') failClosed();
      }
    }
    for (const resource of pendingClaimsForManifest) {
      const file = manifestClaimFile(manifest, resource);
      try {
        const claim = readJson(file);
        if (claimMatches(claim, manifest.id, resource, manifest.identityVersion ?? 1)) fs.rmSync(file, {force: true});
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
    if (!claim || typeof claim.taskId !== 'string') throw new ProjectBusyError();
    const isV2 = claim.identityVersion === 2;
    const resource = isV2 ? claim.resourcePath : claim.resource;
    if (typeof resource !== 'string' || !path.isAbsolute(resource) || (isV2 && claim.claimKey !== claimKey(resource))) throw new ProjectBusyError();
    const taskRoot = path.join(tasksDir, claim.taskId);
    let manifest;
    try { manifest = readJson(path.join(taskRoot, 'manifest.json')); } catch { throw new ProjectBusyError(); }
    if (manifest.id !== claim.taskId || manifest.taskRoot !== taskRoot || (isV2 ? manifest.identityVersion !== 2 : manifest.identityVersion === 2)) throw new ProjectBusyError();
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
    if (!knownClaims.some((known) => claimKey(known) === claimKey(resource))) throw new ProjectBusyError();
    if (isV2 && claimFile(resource) !== file) throw new ProjectBusyError();
    if (!isV2) {
      // Legacy filenames used a filesystem-derived identity.  Before deleting
      // anything, prove that every required legacy resource has exactly one
      // matching claim for this dead task.
      const legacyFiles = fs.readdirSync(claimsDir).filter((name) => name.endsWith('.json'));
      for (const required of knownClaims) {
        const matches = legacyFiles.filter((name) => {
          try {
            const candidate = readJson(path.join(claimsDir, name));
            return candidate?.identityVersion !== 2 && candidate.taskId === claim.taskId
              && typeof candidate.resource === 'string' && claimKey(candidate.resource) === claimKey(required);
          } catch { throw new ProjectBusyError(); }
        });
        if (matches.length !== 1) throw new ProjectBusyError();
      }
    }
    // Only a confirmed dead owner can be recovered; unknown liveness stays busy.
    if (!manifest.owner || liveness(manifest.owner) !== 'dead') throw new ProjectBusyError();
    if (manifest.executor) {
      const stopped = terminateExecutor(manifest.executor);
      if (stopped && typeof stopped.then === 'function') throw new ProjectBusyError();
      if (!stopped || liveness(manifest.executor) !== 'dead') throw new ProjectBusyError();
    }
    releaseManifest(manifest);
  };

  const recoverLegacyBeforeV2Write = (keys) => {
    const requested = new Set(keys);
    const legacyClaims = new Map();
    const requestedClaimFiles = new Set();
    const claimIndex = new Map();
    for (const name of fs.readdirSync(claimsDir)) {
      if (!name.endsWith('.json')) continue;
      let claim;
      try { claim = readJson(path.join(claimsDir, name)); } catch { failClosed(); }
      if (claim?.identityVersion === 2) continue;
      if (!claim || typeof claim.taskId !== 'string' || typeof claim.resource !== 'string') failClosed();
      const key = claimKey(claim.resource);
      if (requested.has(key)) requestedClaimFiles.add(path.join(claimsDir, name));
      const entries = legacyClaims.get(claim.taskId) ?? [];
      entries.push({file: path.join(claimsDir, name), claim, key});
      legacyClaims.set(claim.taskId, entries);
      const indexed = claimIndex.get(key) ?? [];
      indexed.push({file: path.join(claimsDir, name), taskId: claim.taskId});
      claimIndex.set(key, indexed);
    }
    const verifiedClaimFiles = new Set();
    const declaredIndex = new Map();
    const recoverable = [];
    for (const id of fs.readdirSync(tasksDir)) {
      const taskRoot = path.join(tasksDir, id);
      let manifest;
      try { manifest = readJson(path.join(taskRoot, 'manifest.json')); } catch { failClosed(); }
      if (manifest?.identityVersion === 2) continue;
      let resources;
      let pending;
      let pendingOutputsForManifest;
      try {
        resources = manifestResources(manifest);
        pending = pendingClaims(manifest);
        pendingOutputsForManifest = pendingOutputs(manifest);
      } catch { failClosed(); }
      const declared = [...resources, ...pending, ...pendingOutputsForManifest];
      if (new Set(declared.map(claimKey)).size !== declared.length) failClosed();
      for (const resource of declared) {
        const key = claimKey(resource);
        const owners = declaredIndex.get(key) ?? new Set();
        owners.add(manifest.id);
        declaredIndex.set(key, owners);
      }
      if (!declared.some((resource) => requested.has(claimKey(resource)))) continue;
      recoverable.push({manifest, declared});
    }
    // Detect cross-task aliasing globally before liveness or recovery can
    // delete either side of an ambiguous legacy key.
    for (const key of requested) {
      if ((declaredIndex.get(key)?.size ?? 0) > 1 || (claimIndex.get(key)?.length ?? 0) > 1) failClosed();
    }
    // A requested key can lead to a task that owns further outputs.  Every
    // key in that full declared set must remain uniquely owned by that same
    // task; do not partially recover one side of a transitive conflict.
    for (const {manifest, declared} of recoverable) {
      for (const resource of declared) {
        const key = claimKey(resource);
        const claims = claimIndex.get(key) ?? [];
        if (declaredIndex.get(key)?.size !== 1 || claims.length !== 1 || claims[0].taskId !== manifest.id) failClosed();
      }
    }
    for (const {manifest, declared} of recoverable) {
      const claims = legacyClaims.get(manifest.id) ?? [];
      // Every declared key has exactly one matching old claim; a missing claim
      // is a conflict, not permission to create a new v2 claim.
      for (const resource of declared) {
        const matches = claims.filter((entry) => entry.key === claimKey(resource));
        if (matches.length !== 1 || !claimMatches(matches[0].claim, manifest.id, resource, 1)) failClosed();
        verifiedClaimFiles.add(matches[0].file);
      }
      if (claims.length !== declared.length) failClosed();
      recoverClaim(claims[0].file);
    }
    // A requested old claim without a complete, verified manifest is not
    // permission to create a v2 claim under a new hash.
    for (const file of requestedClaimFiles) if (!verifiedClaimFiles.has(file)) failClosed();
  };

  const acquire = ({resources, outputPaths = [], kind = null}) => {
    const canonicalOutputs = [...new Set(outputPaths.map(artifact))].sort();
    const requested = [...(resources ?? []).map(canonical), ...canonicalOutputs];
    const unique = [...new Map(requested.map((resource) => [claimKey(resource), resource])).values()].sort();
    if (unique.length === 0) throw new Error('任务缺少资源 claim');
    // No v2 task directory, manifest, or claim may be written until legacy
    // claim contents for these stable keys have been proved recoverable.
    recoverLegacyBeforeV2Write(unique.map(claimKey));
    const id = crypto.randomUUID();
    const taskRoot = path.join(tasksDir, id);
    const token = crypto.randomBytes(32).toString('hex');
    const manifest = {
      identityVersion: 2, id, taskRoot, resources: [], claimKeys: [], outputPaths: canonicalOutputs, pendingClaims: unique, pendingClaimKeys: unique.map(claimKey), tokenHash: hash(token),
      owner: executorIdentity(process.pid), platform: process.platform, kind,
      spawnIntent: false, executor: null, pendingOutputClaims: null,
    };
    makePrivateDir(taskRoot);
    try {
      writeJson(path.join(taskRoot, 'manifest.json'), manifest);
      for (const resource of unique) {
        const file = claimFile(resource);
        try { writeClaim(file, id, resource, manifest.tokenHash); }
        catch (error) {
          if (error?.code !== 'EEXIST') throw error;
          recoverClaim(file);
          writeClaim(file, id, resource, manifest.tokenHash);
        }
      }
      replaceJson(path.join(taskRoot, 'manifest.json'), {...manifest, resources: unique, claimKeys: unique.map(claimKey), pendingClaims: null, pendingClaimKeys: null});
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
      .filter((output) => !manifest.outputPaths.some((existing) => claimKey(existing) === claimKey(output))).sort();
    recoverLegacyBeforeV2Write(additions.map(claimKey));
    // First persist intent. If this process dies after a claim is created,
    // stale recovery sees it here and removes only this transaction's claims.
    update(lease, {pendingOutputClaims: additions, pendingClaimKeys: additions.map(claimKey)});
    try {
      for (const output of additions) {
        const claim = claimFile(output);
        try { writeClaim(claim, lease.id, output, manifest.tokenHash); }
        catch (error) {
          if (error?.code !== 'EEXIST') throw error;
          recoverClaim(claim);
          writeClaim(claim, lease.id, output, manifest.tokenHash);
        }
      }
      update(lease, {
        resources: [...new Set([...manifest.resources, ...additions])].sort(),
        claimKeys: [...new Set([...manifest.resources, ...additions])].sort().map(claimKey),
        outputPaths: [...new Set([...manifest.outputPaths, ...additions])].sort(),
        pendingOutputClaims: null,
        pendingClaimKeys: null,
      });
      return additions;
    } catch (error) {
      for (const output of additions) {
        try {
          const claim = readJson(claimFile(output));
          if (claimMatches(claim, lease.id, output)) fs.rmSync(claimFile(output), {force: true});
        } catch { /* Fail closed on the original error. */ }
      }
      try { update(lease, {pendingOutputClaims: null, pendingClaimKeys: null}); } catch { /* original error wins */ }
      throw error;
    }
  };
  const prepareOutputTransaction = (lease, entries) => {
    const manifest = readJson(path.join(lease.taskRoot, 'manifest.json'));
    if (manifest.id !== lease.id || manifest.tokenHash !== hash(lease.token) || outputTransaction(manifest)) throw new Error('task output transaction 无效');
    const outputs = outputClaims(manifest);
    const paths = entries.map((entry) => {
      const finalPath = artifact(entry.finalPath);
      const owned = manifest.resources.find((resource) => claimKey(resource) === claimKey(finalPath));
      if (!outputs.some((output) => claimKey(output) === claimKey(finalPath)) || !owned) throw new Error('task lease 未认领安装输出');
      return {path: owned, hadFinal: regularFileOrMissing(owned), delete: Boolean(entry.delete)};
    }).sort((left, right) => left.path.localeCompare(right.path));
    if (paths.length === 0 || new Set(paths.map((entry) => claimKey(entry.path))).size !== paths.length) throw new Error('原子安装包含重复目标');
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
  /**
   * Read-only authoritative check for an authenticated v2 lease.  Ordinary
   * absence or identity mismatch returns false; malformed JSON, unsafe paths,
   * and other unknown I/O states throw rather than granting ownership.
   */
  const verifyLeaseOwnership = (lease) => {
    if (!lease || typeof lease.id !== 'string' || typeof lease.token !== 'string' || typeof lease.taskRoot !== 'string') return false;
    const file = path.join(lease.taskRoot, 'manifest.json');
    let manifest;
    try { manifest = readJson(file); } catch (error) {
      if (error?.code === 'ENOENT') return false;
      throw error;
    }
    if (manifest.identityVersion !== 2 || manifest.id !== lease.id || manifest.taskRoot !== lease.taskRoot || manifest.tokenHash !== hash(lease.token)) return false;
    const resources = manifestResources(manifest);
    const pending = pendingClaims(manifest);
    const pendingOutputsForManifest = pendingOutputs(manifest);
    const durable = [...resources, ...pending, ...pendingOutputsForManifest];
    if (new Set(durable.map(claimKey)).size !== durable.length) throw new ProjectBusyError();
    for (const resource of durable) {
      let claim;
      try { claim = readJson(claimFile(resource)); } catch (error) {
        if (error?.code === 'ENOENT') return false;
        throw error;
      }
      if (!claimMatches(claim, lease.id, resource, 2) || claim.tokenHash !== manifest.tokenHash) return false;
    }
    return true;
  };
  const attachInheritedLease = ({id = process.env.KISEKI_LEASE_TASK_ID, token = process.env.KISEKI_LEASE_TASK_TOKEN, taskRoot = process.env.KISEKI_LEASE_TASK_ROOT, expectedFolder, expectedOutputPaths = [], allowedParentKinds = []} = {}) => {
    if (!id && !token && !taskRoot) return null;
    if (!id || !token || !taskRoot) throw new Error('task lease 环境不完整');
    const expectedRoot = path.join(tasksDir, id);
    if (taskRoot !== expectedRoot) throw new Error('taskRoot 越界');
    const manifest = readJson(path.join(taskRoot, 'manifest.json'));
    if (manifest.id !== id || manifest.taskRoot !== taskRoot || manifest.tokenHash !== hash(token)) throw new Error('task ownership 无效');
    const resources = manifestResources(manifest);
    const outputs = outputClaims(manifest);
    pendingOutputs(manifest);
    if (!expectedFolder || !resources.some((resource) => claimKey(resource) === claimKey(canonical(expectedFolder)))) throw new Error('task lease 与命令不匹配');
    if ([...new Set(expectedOutputPaths.map(artifact).map(claimKey))].some((key) => !outputs.some((output) => claimKey(output) === key))) {
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
      const claim = readJson(manifestClaimFile(manifest, resource));
      if (!claimMatches(claim, id, resource, manifest.identityVersion ?? 1)) throw new Error('task lease claim 无效');
    }
    return {id, token, taskRoot, resources, inherited: true};
  };
  const inherit = ({kind, folder, ...args} = {}) => attachInheritedLease({expectedFolder: folder, allowedParentKinds: kind ? [kind] : [], ...args});
  return {acquire, extendOutputClaims, prepareOutputTransaction, setOutputTransactionPhase, rollbackOutputTransaction, finalizeOutputTransaction, markSpawnIntent, registerExecutor, release, verifyLeaseOwnership, inherit, attachInheritedLease, registryRoot};
};

/** Acquire for direct CLIs, or validate the parent web-job lease before writes. */
export const acquireCommandLease = ({kind, folder, outputPaths = [], manager = createTaskLeaseManager(), env = process.env} = {}) => {
  const inherited = manager.attachInheritedLease({expectedFolder: folder, expectedOutputPaths: outputPaths, allowedParentKinds: [kind], id: env.KISEKI_LEASE_TASK_ID, token: env.KISEKI_LEASE_TASK_TOKEN, taskRoot: env.KISEKI_LEASE_TASK_ROOT});
  const lease = inherited ?? manager.acquire({kind, resources: [folder], outputPaths});
  const tempDir = path.join(lease.taskRoot, 'tmp');
  makePrivateDir(tempDir);
  // Direct CLIs do not otherwise receive the Web lease environment. Keep the
  // task id available to same-process render children so their artifacts remain
  // derivable from this lease's output claims.
  return {lease, manager, inherited: Boolean(inherited), env: {KISEKI_LEASE_TASK_ID: lease.id, KISEKI_LEASE_TASK_TOKEN: lease.token, KISEKI_LEASE_TASK_ROOT: lease.taskRoot, TMPDIR: tempDir, TMP: tempDir, TEMP: tempDir}};
};
