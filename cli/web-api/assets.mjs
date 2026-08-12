/** 受限的单文件资产操作;这里不是通用文件管理器. */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import {renamePerPhotoConfig, resolveProjectPaths, scanFolderLoose} from '../project.mjs';
import {isRecognizedLyricsManageable} from '../recognized-lyrics.mjs';
import {createTaskLeaseManager, ProjectBusyError} from '../task-lease.mjs';

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const AUDIO_EXTS = new Set(['.mp3', '.m4a', '.wav', '.flac', '.aac', '.ogg']);
const VIDEO_EXTS = new Set(['.mp4', '.mov', '.avi', '.mkv', '.webm', '.m4v']);
const STEM_RE = /^[^/\\\0]+$/;
const locks = new Set();
const undoRecords = new Map();

export class AssetMutationError extends Error {
  constructor(status, message, details = null, cause = null) { super(message, cause ? {cause} : undefined); this.status = status; this.details = details; }
}

const recoveryFailure = (record, message, cause) => new AssetMutationError(409, message, {recoveryUndoId: record.id, recoveryRequired: true}, cause);

const inside = (root, target) => target === root || target.startsWith(root + path.sep);
const stem = (file) => path.basename(file, path.extname(file));
const move = (from, to) => fs.renameSync(from, to);

export const withProjectMutationLock = (folder, task) => {
  const key = fs.realpathSync(folder);
  if (locks.has(key)) throw new AssetMutationError(409, '该项目正在处理另一项文件操作');
  locks.add(key);
  try { return task(key); } finally { locks.delete(key); }
};

export const assertNoRunningJob = (isJobRunning) => {
  if (isJobRunning?.()) throw new AssetMutationError(409, '任务运行中,不能修改文件');
};

const currentAssets = (folder) => {
  const scan = scanFolderLoose(folder);
  const output = path.join(folder, 'output');
  const list = (dir, exts) => fs.existsSync(dir) ? fs.readdirSync(dir, {withFileTypes: true})
    .filter((entry) => entry.isFile() && exts.has(path.extname(entry.name).toLowerCase()))
    .map((entry) => path.relative(folder, path.join(dir, entry.name))) : [];
  return [
    ...scan.photos.map((relativePath) => ({kind: 'photo', relativePath})),
    ...scan.audios.map((relativePath) => ({kind: 'audio', relativePath})),
    ...scan.lyrics.map((relativePath) => ({kind: 'lyrics', relativePath})),
    ...list(path.join(output, 'stills'), IMAGE_EXTS).map((relativePath) => ({kind: 'still', relativePath})),
    ...list(output, VIDEO_EXTS).map((relativePath) => ({kind: 'video', relativePath})),
  ];
};

const resolveAsset = (folder, assetId) => {
  if (typeof assetId !== 'string') throw new AssetMutationError(400, 'assetId 无效');
  const item = currentAssets(folder).find((candidate) => `${candidate.kind}:${candidate.relativePath}` === assetId);
  if (!item) throw new AssetMutationError(404, '资产不存在或已变化');
  const target = path.resolve(folder, item.relativePath);
  const parent = path.dirname(target);
  let stat;
  try { stat = fs.lstatSync(target); } catch { throw new AssetMutationError(404, '资产不存在或已变化'); }
  if (!stat.isFile() || stat.isSymbolicLink() || fs.realpathSync(target) !== target || fs.realpathSync(parent) !== parent) {
    throw new AssetMutationError(403, '文件路径不安全或已变化');
  }
  if (!inside(fs.realpathSync(folder), target)) throw new AssetMutationError(403, '文件路径越界');
  return {...item, target, parent};
};

const pairedLyrics = (folder, audio) => currentAssets(folder)
  .filter((item) => item.kind === 'lyrics' && stem(item.relativePath) === stem(audio.relativePath))
  .map((item) => resolveAsset(folder, `lyrics:${item.relativePath}`));

const resolveMetadataFile = (folder, target, required) => {
  if (!pathExists(target)) {
    if (required) throw new AssetMutationError(409, '识别结果不存在或已变化');
    return null;
  }
  try {
    const stat = fs.lstatSync(target);
    const parent = path.dirname(target);
    if (!stat.isFile() || stat.isSymbolicLink() || fs.lstatSync(parent).isSymbolicLink()
      || fs.realpathSync(target) !== target || fs.realpathSync(parent) !== parent || !inside(folder, target)) throw new Error('unsafe');
  } catch { throw new AssetMutationError(409, '识别结果路径不安全或已变化'); }
  return target;
};

const invalidateDerived = (folder, operationDir, kind) => {
  if (kind !== 'photo' && kind !== 'audio' && kind !== 'lyrics') return [];
  const paths = resolveProjectPaths(folder);
  const names = kind === 'photo' || kind === 'lyrics'
    ? [paths.timelinePath]
    : [paths.timelinePath, paths.analysisPath, paths.beatsPath, paths.lyricsPath];
  const moved = [];
  for (const source of names) {
    if (!fs.existsSync(source) || !fs.lstatSync(source).isFile()) continue;
    const destination = operationPath(operationDir, 'derived', path.basename(source));
    fs.mkdirSync(path.dirname(destination), {recursive: true});
    move(source, destination);
    moved.push({source, destination});
  }
  return moved;
};

const rollbackForwardMoves = (moves) => {
  for (const {from, to} of [...moves].reverse()) {
    try { if (fs.existsSync(to) && !fs.existsSync(from)) move(to, from); } catch {}
  }
};

const canonicalRegularFile = (target, root) => {
  const parent = path.dirname(target);
  const stat = fs.lstatSync(target);
  const parentStat = fs.lstatSync(parent);
  if (!inside(root, target) || !inside(root, parent) || !stat.isFile() || stat.isSymbolicLink()
    || !parentStat.isDirectory() || parentStat.isSymbolicLink()
    || fs.realpathSync(target) !== target || fs.realpathSync(parent) !== parent) throw new Error('unsafe file');
};

const canonicalParent = (target, root) => {
  const parent = path.dirname(target);
  const stat = fs.lstatSync(parent);
  if (!inside(root, target) || !inside(root, parent) || !stat.isDirectory() || stat.isSymbolicLink() || fs.realpathSync(parent) !== parent) {
    throw new Error('unsafe parent');
  }
};

/** Preflight every entry before moving any one of them. */
const preflightRestore = (record) => {
  const folder = fs.realpathSync(record.folder);
  if (folder !== record.folder) throw new Error('project drift');
  assertCanonicalDirectory(record.operationDir, folder, '回收记录路径已变化');
  return record.files.map((change) => {
    const source = change.to;
    const destination = change.from;
    const sourceRoot = change.storedInOperation ? record.operationDir : folder;
    if (!inside(sourceRoot, source) || !inside(folder, destination)) throw new Error('path drift');
    const sourceExists = pathExists(source);
    const destinationExists = pathExists(destination);
    if (sourceExists === destinationExists) throw new Error('mixed state');
    if (sourceExists) {
      canonicalRegularFile(source, sourceRoot);
      canonicalParent(destination, folder);
      return {change, source, destination, move: true};
    }
    canonicalRegularFile(destination, folder);
    canonicalParent(source, sourceRoot);
    return {change, source, destination, move: false};
  });
};

const recordReady = (record) => {
  try {
    const entries = preflightRestore(record);
    return entries.every((entry) => entry.move);
  } catch { return false; }
};

const restoreClearAfterLeaseFailure = (record) => {
  const moved = [];
  try {
    const entries = preflightRestore(record);
    for (const entry of entries) {
      if (entry.move) { move(entry.source, entry.destination); moved.push(entry); }
    }
    for (const entry of entries) canonicalRegularFile(entry.destination, record.folder);
    record.restored = true;
    record.recoveryState = 'cleanup-pending';
    removeOperationDir(record);
    undoRecords.delete(record.id);
  } catch (primary) {
    const compensation = [];
    for (const entry of [...moved].reverse()) {
      try {
        if (pathExists(entry.destination) && !pathExists(entry.source)) move(entry.destination, entry.source);
        else throw new Error('compensation drift');
      } catch (error) { compensation.push(error); }
    }
    record.restored = false;
    record.recoveryState = recordReady(record) ? 'ready' : 'recovery-required';
    throw recoveryFailure(record, 'lease 释放失败,清除恢复未完成', new AggregateError([primary, ...compensation]));
  }
};

const trashDir = (folder, id) => path.join(folder, '.kiseki-trash', id);

const assertCanonicalDirectory = (directory, folder, message) => {
  let stat;
  try { stat = fs.lstatSync(directory); } catch { throw new AssetMutationError(409, message); }
  if (!stat.isDirectory() || stat.isSymbolicLink() || fs.realpathSync(directory) !== directory || !inside(folder, directory)) {
    throw new AssetMutationError(409, message);
  }
};

const createOperationDir = (folder, id) => {
  const root = path.join(folder, '.kiseki-trash');
  try { fs.mkdirSync(root); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  assertCanonicalDirectory(root, folder, '项目回收区路径已变化');
  const operationDir = trashDir(folder, id);
  try { fs.mkdirSync(operationDir); } catch (error) {
    if (error.code === 'EEXIST') throw new AssetMutationError(409, '回收操作已存在');
    throw error;
  }
  assertCanonicalDirectory(root, folder, '项目回收区路径已变化');
  assertCanonicalDirectory(operationDir, folder, '回收操作路径已变化');
  if (path.dirname(operationDir) !== root) throw new AssetMutationError(409, '回收操作路径已变化');
  return operationDir;
};

const operationPath = (operationDir, ...parts) => {
  const target = path.join(operationDir, ...parts);
  if (!inside(operationDir, target)) throw new AssetMutationError(409, '回收操作路径已变化');
  return target;
};

const pathExists = (target) => {
  try { fs.lstatSync(target); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
};

const relativeMove = (folder, operationDir, move) => {
  const from = move.from ?? move.source;
  const to = move.to ?? move.destination;
  return {
    from: path.relative(folder, from),
    to: inside(operationDir, to) ? path.relative(operationDir, to) : path.relative(folder, to),
    storedInOperation: inside(operationDir, to),
  };
};

const writeManifest = ({folder, operationDir, id, action, files, derived, config = null}) => {
  fs.writeFileSync(operationPath(operationDir, 'manifest.json'), `${JSON.stringify({
    version: 2,
    id,
    action,
    files: files.map((move) => relativeMove(folder, operationDir, move)),
    derived: derived.map((move) => relativeMove(folder, operationDir, move)),
    config,
  }, null, 2)}\n`);
};

const restoreConfig = ({jsonPath, rawText}) => {
  const temporary = `${jsonPath}.${process.pid}.${crypto.randomUUID()}.undo`;
  try {
    fs.writeFileSync(temporary, rawText, 'utf8');
    move(temporary, jsonPath);
  } finally {
    if (fs.existsSync(temporary)) fs.rmSync(temporary, {force: true});
  }
};

const removeOperationDir = (record) => {
  const root = path.join(record.folder, '.kiseki-trash');
  if (record.operationDir !== trashDir(record.folder, record.id) || !inside(root, record.operationDir)) {
    throw new AssetMutationError(409, '回收记录路径已变化');
  }
  if (pathExists(root)) assertCanonicalDirectory(root, record.folder, '回收记录路径已变化');
  if (pathExists(record.operationDir)) {
    assertCanonicalDirectory(record.operationDir, record.folder, '回收记录路径已变化');
    const manifestPath = operationPath(record.operationDir, 'manifest.json');
    let manifest;
    try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch { throw new AssetMutationError(409, '回收记录已变化,不能清理'); }
    const expectedConfig = record.config ? {
      path: path.relative(record.folder, record.config.jsonPath),
      backup: path.relative(record.operationDir, record.config.backupPath),
    } : null;
    if (manifest.id !== record.id || manifest.action !== record.action || !Array.isArray(manifest.files) || !Array.isArray(manifest.derived)
      || JSON.stringify(manifest.files) !== JSON.stringify(record.files.map((move) => relativeMove(record.folder, record.operationDir, move)))
      || JSON.stringify(manifest.derived) !== JSON.stringify(record.derived.map((move) => relativeMove(record.folder, record.operationDir, move)))
      || JSON.stringify(manifest.config ?? null) !== JSON.stringify(expectedConfig)) {
      throw new AssetMutationError(409, '回收记录已变化,不能清理');
    }
    const expectedFiles = new Set(['manifest.json']);
    const restoredPaths = new Set();
    const addOperationPath = (relative, destination) => {
      if (typeof relative !== 'string' || !relative || path.isAbsolute(relative)) throw new AssetMutationError(409, '回收记录已变化,不能清理');
      const target = operationPath(record.operationDir, relative);
      if (path.relative(record.operationDir, target) !== relative || !inside(record.operationDir, target)) throw new AssetMutationError(409, '回收记录已变化,不能清理');
      (destination ? expectedFiles : restoredPaths).add(relative);
    };
    // Undo has already moved operation-stored files back to the project.  Their
    // paths must now be absent; only the manifest and config backup remain.
    for (const entry of [...manifest.files, ...manifest.derived]) if (entry?.storedInOperation) addOperationPath(entry.to, false);
    if (manifest.config) addOperationPath(manifest.config.backup, true);
    const expectedDirs = new Set(['']);
    for (const relative of [...expectedFiles, ...restoredPaths]) {
      for (let parent = path.dirname(relative); parent && parent !== '.'; parent = path.dirname(parent)) expectedDirs.add(parent);
    }
    const walk = (directory, relative = '') => {
      for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
        const childRelative = relative ? path.join(relative, entry.name) : entry.name;
        const child = operationPath(record.operationDir, childRelative);
        const stat = fs.lstatSync(child);
        if (stat.isSymbolicLink()) throw new AssetMutationError(409, '回收记录已变化,不能清理');
        if (stat.isDirectory()) {
          if (!expectedDirs.has(childRelative)) throw new AssetMutationError(409, '回收记录已变化,不能清理');
          walk(child, childRelative);
        } else if (!stat.isFile() || !expectedFiles.has(childRelative)) throw new AssetMutationError(409, '回收记录已变化,不能清理');
      }
    };
    walk(record.operationDir);
    for (const relative of expectedFiles) {
      const stat = fs.lstatSync(operationPath(record.operationDir, relative));
      if (!stat.isFile() || stat.isSymbolicLink()) throw new AssetMutationError(409, '回收记录已变化,不能清理');
    }
    for (const relative of restoredPaths) {
      if (pathExists(operationPath(record.operationDir, relative))) throw new AssetMutationError(409, '回收记录已变化,不能清理');
    }
    fs.rmSync(record.operationDir, {recursive: true});
  }
  try { fs.rmdirSync(root); } catch (error) { if (error.code !== 'ENOTEMPTY' && error.code !== 'ENOENT') throw error; }
};

const commitPermanentOperation = (record) => {
  const root = path.join(record.folder, '.kiseki-trash');
  if (record.operationDir !== trashDir(record.folder, record.id) || !inside(root, record.operationDir)) {
    throw new AssetMutationError(409, '临时删除记录路径已变化');
  }
  assertCanonicalDirectory(root, record.folder, '临时删除记录路径已变化');
  assertCanonicalDirectory(record.operationDir, record.folder, '临时删除记录路径已变化');
  fs.rmSync(record.operationDir, {recursive: true});
  try { fs.rmdirSync(root); } catch (error) { if (error.code !== 'ENOTEMPTY' && error.code !== 'ENOENT') throw error; }
  undoRecords.delete(record.id);
};

const withMutationLease = (folder, task, leaseManager = createTaskLeaseManager()) => {
  let lease;
  let released = false;
  let retainLease = false;
  try {
    lease = leaseManager.acquire({kind: 'asset-mutation', resources: [folder]});
    return withProjectMutationLock(folder, () => {
      const result = task(fs.realpathSync(folder));
      let releaseError = null;
      let releaseOk = false;
      try { releaseOk = leaseManager.release(lease); released = releaseOk; } catch (error) { releaseError = error; }
      if (!releaseOk) {
        try { result?.rollbackLeaseFailure?.(); } catch (rollbackError) {
          if (rollbackError instanceof AssetMutationError && rollbackError.details?.recoveryUndoId) {
            const recoveryRecord = result?.recoveryRecord;
            if (recoveryRecord && recoveryRecord.id === rollbackError.details.recoveryUndoId) {
              recoveryRecord.recoveryLease = {lease, leaseManager, folder: fs.realpathSync(folder)};
              retainLease = true;
            }
            if (releaseError) {
              rollbackError.cause ??= releaseError;
              rollbackError.errors = [releaseError, rollbackError.cause].filter(Boolean);
            }
            throw rollbackError;
          }
          throw new AggregateError([releaseError, rollbackError].filter(Boolean), 'lease 释放失败,且无法回滚清除结果');
        }
        throw releaseError ?? new Error('任务 lease 释放失败');
      }
      if (result?.commitAfterRelease) {
        try { result.commitAfterRelease(); } catch (error) {
          const record = result.recoveryRecord;
          if (record) throw recoveryFailure(record, '操作已执行，但永久删除的临时记录清理失败', error);
          throw error;
        }
      }
      return result?.data ?? result;
    });
  } catch (error) {
    if (error instanceof ProjectBusyError) throw new AssetMutationError(409, '项目已有任务在执行');
    throw error;
  } finally {
    if (lease && !released && !retainLease) { try { leaseManager.release(lease); } catch {} }
  }
};

export const mutateAsset = ({folder, assetId, action, stem: newStem, isJobRunning, leaseManager}) => withMutationLease(folder, (canonicalFolder) => {
  folder = canonicalFolder;
  assertNoRunningJob(isJobRunning);
  const asset = resolveAsset(folder, assetId);
  if (action === 'rename') {
    if (typeof newStem !== 'string' || !newStem.trim() || ['.', '..'].includes(newStem.trim()) || !STEM_RE.test(newStem) || newStem.includes(path.sep)) {
      throw new AssetMutationError(400, '文件名无效');
    }
    const name = `${newStem.trim()}${path.extname(asset.target)}`;
    const destination = path.join(asset.parent, name);
    if (fs.existsSync(destination)) throw new AssetMutationError(409, '目标文件已存在');
    const pair = asset.kind === 'audio' ? pairedLyrics(folder, asset) : [];
    const changes = [{from: asset.target, to: destination}];
    for (const lyric of pair) {
      const to = path.join(lyric.parent, `${newStem.trim()}${path.extname(lyric.target)}`);
      if (fs.existsSync(to)) throw new AssetMutationError(409, '配对歌词的目标文件已存在');
      changes.push({from: lyric.target, to});
    }
    let configBackup = null;
    let derived = [];
    const id = crypto.randomUUID();
    const operationDir = createOperationDir(folder, id);
    try {
      if (asset.kind === 'photo') {
        try { configBackup = renamePerPhotoConfig(folder, path.basename(asset.target), name); } catch (error) {
          throw new AssetMutationError(409, error.message);
        }
        if (configBackup) {
          const backupPath = operationPath(operationDir, 'metadata', 'kiseki.json');
          fs.mkdirSync(path.dirname(backupPath), {recursive: true});
          fs.writeFileSync(backupPath, configBackup.rawText, 'utf8');
          configBackup = {...configBackup, backupPath};
        }
      }
      for (const change of changes) move(change.from, change.to);
      derived = invalidateDerived(folder, operationDir, asset.kind);
      writeManifest({
        folder, operationDir, id, action: 'rename', files: changes, derived,
        config: configBackup ? {path: path.relative(folder, configBackup.jsonPath), backup: path.relative(operationDir, configBackup.backupPath)} : null,
      });
    } catch (error) {
      rollbackForwardMoves(changes);
      for (const entry of [...derived].reverse()) {
        try { if (fs.existsSync(entry.destination) && !fs.existsSync(entry.source)) move(entry.destination, entry.source); } catch {}
      }
      if (configBackup) fs.writeFileSync(configBackup.jsonPath, configBackup.rawText, 'utf8');
      throw error;
    }
    const record = {id, action, folder, operationDir, files: changes.map((change) => ({...change, storedInOperation: false})), derived, config: configBackup};
    undoRecords.set(id, record);
    return {
      data: {assetId: `${asset.kind}:${path.relative(folder, destination)}`, name},
      recoveryRecord: record,
      rollbackLeaseFailure: () => undoAssetDeleteCore({folder, undoId: id, isJobRunning}),
      commitAfterRelease: () => commitPermanentOperation(record),
    };
  }
  if (action !== 'delete') throw new AssetMutationError(400, '不支持的操作');
  const id = crypto.randomUUID();
  const operationDir = createOperationDir(folder, id);
  const pair = asset.kind === 'audio' ? pairedLyrics(folder, asset) : [];
  const items = [asset, ...pair];
  const changes = items.map((item) => ({from: item.target, to: operationPath(operationDir, 'files', item.relativePath)}));
  let derived = [];
  try {
    for (const change of changes) fs.mkdirSync(path.dirname(change.to), {recursive: true});
    for (const change of changes) move(change.from, change.to);
    derived = invalidateDerived(folder, operationDir, asset.kind);
    writeManifest({folder, operationDir, id, action: 'delete', files: changes, derived});
  } catch (error) {
    rollbackForwardMoves(changes);
    for (const entry of [...derived].reverse()) {
      try { if (fs.existsSync(entry.destination) && !fs.existsSync(entry.source)) move(entry.destination, entry.source); } catch {}
    }
    throw error;
  }
  const record = {id, action, folder, operationDir, files: changes.map((change) => ({...change, storedInOperation: true})), derived, config: null};
  undoRecords.set(id, record);
  return {
    data: {},
    recoveryRecord: record,
    rollbackLeaseFailure: () => undoAssetDeleteCore({folder, undoId: id, isJobRunning}),
    commitAfterRelease: () => commitPermanentOperation(record),
  };
}, leaseManager);

export const clearRecognizedLyrics = ({folder, isJobRunning, leaseManager}) => withMutationLease(folder, (canonicalFolder) => {
  folder = canonicalFolder;
  assertNoRunningJob(isJobRunning);
  // Re-read at mutation time: any LRC appearing after the preview makes this a
  // source change, so fail closed rather than deleting recognized metadata.
  const lrcFiles = scanFolderLoose(folder).lyrics;
  if (lrcFiles.length !== 0) throw new AssetMutationError(409, '检测到 LRC 歌词,不能清除本地识别结果');
  const paths = resolveProjectPaths(folder);
  const lyrics = resolveMetadataFile(folder, paths.lyricsPath, true);
  if (!isRecognizedLyricsManageable({lyricsPath: lyrics, lrcFiles})) throw new AssetMutationError(409, '识别结果不存在或已变化');
  const files = [lyrics, resolveMetadataFile(folder, paths.timelinePath, false)].filter(Boolean);
  const id = crypto.randomUUID();
  const operationDir = createOperationDir(folder, id);
  const changes = files.map((from) => ({from, to: operationPath(operationDir, 'files', path.relative(folder, from))}));
  const record = {id, action: 'clear-recognized-lyrics', folder, operationDir, files: changes.map((change) => ({...change, storedInOperation: true})), derived: [], config: null, recoveryState: 'moving'};
  undoRecords.set(id, record);
  const moved = [];
  try {
    for (const change of changes) {
      if (fs.existsSync(change.to)) throw new AssetMutationError(409, '回收目标已存在');
      fs.mkdirSync(path.dirname(change.to), {recursive: true});
    }
    writeManifest({folder, operationDir, id, action: 'clear-recognized-lyrics', files: changes, derived: []});
    for (const change of changes) { move(change.from, change.to); moved.push(change); }
  } catch (error) {
    const restoreErrors = [];
    for (const change of [...moved].reverse()) {
      try { if (fs.existsSync(change.to) && !fs.existsSync(change.from)) move(change.to, change.from); else throw new Error('clear restore drift'); } catch (restoreError) { restoreErrors.push(restoreError); }
    }
    record.restored = false;
    record.recoveryState = restoreErrors.length ? 'recovery-required' : 'cleanup-pending';
    if (restoreErrors.length) throw recoveryFailure(record, '清除失败且恢复未完成', new AggregateError([error, ...restoreErrors]));
    record.restored = true;
    try { removeOperationDir(record); undoRecords.delete(id); } catch (cleanupError) { throw recoveryFailure(record, '清除失败,回收记录保留以便恢复', new AggregateError([error, cleanupError])); }
    throw error;
  }
  record.recoveryState = 'ready';
  return {
    data: {undoId: id},
    recoveryRecord: record,
    rollbackLeaseFailure: () => {
      restoreClearAfterLeaseFailure(record);
    },
  };
}, leaseManager);

const undoAssetDeleteCore = ({folder, undoId, isJobRunning, retainRecord = false}) => {
  assertNoRunningJob(isJobRunning);
  if (typeof undoId !== 'string' || !/^[0-9a-f-]{36}$/i.test(undoId)) throw new AssetMutationError(400, 'undoId 无效');
  const record = undoRecords.get(undoId);
  if (!record || record.folder !== folder) throw new AssetMutationError(404, '撤销记录不存在(服务重启后不可撤销)');
  if (record.recoveryState === 'cleanup-pending' || record.restored) {
    try { removeOperationDir(record); if (!retainRecord) undoRecords.delete(undoId); return {restored: 0}; }
    catch (error) { throw recoveryFailure(record, '文件已恢复,但回收记录尚未清理', error); }
  }
  if (record.action !== 'rename' && record.action !== 'delete' && record.action !== 'clear-recognized-lyrics') throw new AssetMutationError(409, '回收记录或目标路径已变化');
  const files = record.files.map((change) => {
    if (typeof change.storedInOperation !== 'boolean' || (record.action === 'rename' ? change.storedInOperation : !change.storedInOperation)) {
      throw new AssetMutationError(409, '回收记录或目标路径已变化');
    }
    return change;
  });
  const changes = [...files, ...record.derived.map(({source, destination}) => ({from: source, to: destination, storedInOperation: true}))];
  const restoreRecord = {...record, files: changes};
  let entries;
  try { entries = preflightRestore(restoreRecord); } catch (error) {
    throw recoveryFailure(record, '回收记录或目标路径已变化', error);
  }
  for (const change of changes) {
    // Rename files remain in the project under their new names; only deleted files,
    // derived metadata, and config backups are stored in the operation directory.
    if (!entries.find((entry) => entry.change === change)?.move) continue;
  }
  if (record.config) {
    const backupPath = record.config.backupPath;
    try {
      if (!inside(record.operationDir, backupPath) || !inside(folder, record.config.jsonPath) || !fs.lstatSync(backupPath).isFile() || fs.lstatSync(backupPath).isSymbolicLink() || !fs.lstatSync(record.config.jsonPath).isFile() || fs.lstatSync(record.config.jsonPath).isSymbolicLink()) throw new Error('link');
      if (fs.realpathSync(backupPath) !== backupPath || fs.realpathSync(path.dirname(backupPath)) !== path.dirname(backupPath) || fs.realpathSync(record.config.jsonPath) !== record.config.jsonPath || fs.realpathSync(path.dirname(record.config.jsonPath)) !== path.dirname(record.config.jsonPath)) throw new Error('drift');
    } catch { throw new AssetMutationError(409, '回收记录或目标路径已变化'); }
  }
  const reverse = entries.filter((entry) => entry.move).map(({source, destination}) => ({from: source, to: destination}));
  try {
    for (const change of reverse) move(change.from, change.to);
    if (record.config) restoreConfig(record.config);
  } catch (error) { rollbackForwardMoves(reverse); throw error; }
  record.restored = true;
  record.recoveryState = 'cleanup-pending';
  try { removeOperationDir(record); } catch (error) {
    throw recoveryFailure(record, '文件已恢复,但回收记录尚未清理', error);
  }
  if (!retainRecord) undoRecords.delete(undoId);
  return {restored: reverse.length};
};

export const undoAssetDelete = ({folder, undoId, isJobRunning, leaseManager}) => {
  const recoveryRecord = typeof undoId === 'string' ? undoRecords.get(undoId) : null;
  if (!recoveryRecord?.recoveryLease) {
    return withMutationLease(folder, (canonicalFolder) => undoAssetDeleteCore({folder: canonicalFolder, undoId, isJobRunning}), leaseManager);
  }
  const held = recoveryRecord.recoveryLease;
  let canonicalFolder;
  try { canonicalFolder = fs.realpathSync(folder); }
  catch (error) { throw recoveryFailure(recoveryRecord, '恢复租约已失效,回收记录已保留', error); }
  if (held.folder !== canonicalFolder || !held.lease || !held.leaseManager) throw recoveryFailure(recoveryRecord, '恢复租约已失效,回收记录已保留');
  let ownsHeldLease = false;
  try { ownsHeldLease = held.leaseManager.verifyLeaseOwnership?.(held.lease) === true; }
  catch (error) { throw recoveryFailure(recoveryRecord, '恢复租约验证失败,回收记录已保留', error); }
  if (!ownsHeldLease) {
    // A stale task root may still exist, but it is not authority to mutate.
    // Discard only this in-memory handle and acquire a new project lease below.
    recoveryRecord.recoveryLease = null;
    try {
      return withMutationLease(folder, (canonicalFolder) => undoAssetDeleteCore({folder: canonicalFolder, undoId, isJobRunning}), leaseManager);
    } catch (error) {
      if (error instanceof AssetMutationError) throw recoveryFailure(recoveryRecord, error.message, error);
      throw error;
    }
  }
  return withProjectMutationLock(canonicalFolder, (lockedFolder) => {
    if (lockedFolder !== held.folder || recoveryRecord !== undoRecords.get(undoId)) throw recoveryFailure(recoveryRecord, '恢复租约已失效,回收记录已保留');
    const result = undoAssetDeleteCore({folder: lockedFolder, undoId, isJobRunning, retainRecord: true});
    let released = false;
    try { released = held.leaseManager.release(held.lease) === true; } catch {}
    if (!released) throw recoveryFailure(recoveryRecord, '恢复完成,但租约释放失败,回收记录已保留');
    recoveryRecord.recoveryLease = null;
    undoRecords.delete(undoId);
    return result;
  });
};
