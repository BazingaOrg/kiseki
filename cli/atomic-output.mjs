import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const partialPrefix = '.kiseki-partial-';

const regularFileOrMissing = (file) => {
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('输出目标必须是普通文件');
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
};

export const resolveAtomicTaskId = ({env = process.env, randomUUID = crypto.randomUUID} = {}) => {
  const inherited = env.KISEKI_LEASE_TASK_ID || env.KISEKI_TASK_ID;
  return String(inherited || randomUUID()).replace(/[^A-Za-z0-9_-]/g, '_');
};

/** Keep the renderer's real extension while staging beside its final target. */
export const createPartialOutput = (finalPath, taskId = resolveAtomicTaskId()) => {
  return outputArtifactPaths(finalPath, taskId).partialPath;
};

export const isAtomicPartialName = (name) => name.startsWith(partialPrefix);

export const removePartialOutput = (partialPath) => {
  if (!isAtomicPartialName(path.basename(partialPath))) throw new Error('不是 kiseki partial 输出');
  fs.rmSync(partialPath, {force: true});
};

/** Every recoverable artifact is derivable from the output claim and task id. */
export const outputArtifactPaths = (finalPath, taskId = resolveAtomicTaskId()) => {
  const resolved = path.resolve(finalPath);
  const ext = path.extname(resolved);
  if (!ext) throw new Error(`原子输出需要文件扩展名: ${resolved}`);
  const name = path.basename(resolved, ext);
  const safeTaskId = String(taskId).replace(/[^A-Za-z0-9_-]/g, '_');
  return {
    finalPath: resolved,
    partialPath: path.join(path.dirname(resolved), `${partialPrefix}${safeTaskId}-${name}${ext}`),
    backupPath: path.join(path.dirname(resolved), `.kiseki-backup-${safeTaskId}-${name}${ext}`),
  };
};

/**
 * Commit a same-directory staged file without copy fallback. Existing output is
 * first moved aside so a failed replacement can restore the previous complete file.
 */
export const commitAtomicOutput = (finalPath, partialPath, {taskId = resolveAtomicTaskId()} = {}) => {
  const {finalPath: finalResolved, backupPath} = outputArtifactPaths(finalPath, taskId);
  const partialResolved = path.resolve(partialPath);
  if (path.dirname(finalResolved) !== path.dirname(partialResolved)) {
    throw new Error('原子输出 partial 必须与正式文件位于同一目录');
  }
  if (!regularFileOrMissing(partialResolved)) throw new Error(`找不到 partial 输出: ${partialResolved}`);
  regularFileOrMissing(finalResolved);

  let backup = null;
  try {
    if (regularFileOrMissing(finalResolved)) {
      backup = backupPath;
      fs.renameSync(finalResolved, backup);
    }
    fs.renameSync(partialResolved, finalResolved);
    if (backup) fs.rmSync(backup, {force: true});
  } catch (error) {
    if (backup && !fs.existsSync(finalResolved) && fs.existsSync(backup)) {
      try {
        fs.renameSync(backup, finalResolved);
      } catch (rollbackError) {
        throw new AggregateError([error, rollbackError], '原子输出替换失败,且无法恢复旧文件');
      }
    }
    throw error;
  }
};

const copyAndSync = (source, target) => {
  const sourceFd = fs.openSync(source, 'r');
  const targetFd = fs.openSync(target, 'w', 0o600);
  try {
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    for (;;) {
      const read = fs.readSync(sourceFd, buffer, 0, buffer.length, null);
      if (read === 0) break;
      fs.writeSync(targetFd, buffer, 0, read);
    }
    fs.fsyncSync(targetFd);
  } finally {
    fs.closeSync(sourceFd);
    fs.closeSync(targetFd);
  }
};

/**
 * Install a group of fetched artifacts as one transaction.  Every partial and
 * backup is derived from a claimed final path, so stale-lease recovery can be
 * precise without scanning user folders.
 */
export const installAtomicOutputs = ({taskId = resolveAtomicTaskId(), writes, deletes = [], transaction = null}) => {
  const entries = [...writes, ...deletes.map((finalPath) => ({finalPath, delete: true}))]
    .map((entry) => ({...entry, ...outputArtifactPaths(entry.finalPath, taskId)}))
    .sort((a, b) => a.finalPath.localeCompare(b.finalPath));
  if (new Set(entries.map((entry) => entry.finalPath)).size !== entries.length) {
    throw new Error('原子安装包含重复目标');
  }
  let phase = 'staging';
  try {
    for (const entry of entries) regularFileOrMissing(entry.finalPath);
    for (const entry of entries) {
      if (entry.delete) continue;
      fs.mkdirSync(path.dirname(entry.finalPath), {recursive: true});
      if (entry.source) copyAndSync(entry.source, entry.partialPath);
      else {
        const fd = fs.openSync(entry.partialPath, 'w', 0o600);
        try { fs.writeFileSync(fd, entry.contents ?? '', 'utf8'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      }
    }
    transaction?.prepare(entries.map(({finalPath, delete: remove = false}) => ({finalPath, delete: Boolean(remove)})));
    phase = 'prepared';
    transaction?.markCommitting();
    phase = 'committing';
    for (const entry of entries) {
      if (fs.existsSync(entry.finalPath)) fs.renameSync(entry.finalPath, entry.backupPath);
    }
    for (const entry of entries) {
      if (!entry.delete) fs.renameSync(entry.partialPath, entry.finalPath);
    }
    transaction?.markCommitted();
    phase = 'committed';
    if (transaction) transaction.finalize();
    else for (const entry of entries) fs.rmSync(entry.backupPath, {force: true});
  } catch (error) {
    if (phase !== 'committed') {
      if (transaction) transaction.rollback();
      else for (const entry of entries) {
        try {
          if (fs.existsSync(entry.backupPath)) {
            if (fs.existsSync(entry.finalPath)) fs.rmSync(entry.finalPath, {force: true});
            fs.renameSync(entry.backupPath, entry.finalPath);
          } else fs.rmSync(entry.partialPath, {force: true});
        } catch { /* Preserve the original install failure. */ }
      }
    }
    throw error;
  } finally {
    if (!transaction) for (const entry of entries) fs.rmSync(entry.partialPath, {force: true});
  }
};
