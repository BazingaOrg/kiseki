/** 受限的单文件资产操作；这里不是通用文件管理器。 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import {renamePerPhotoConfig, resolveProjectPaths, scanFolderLoose} from '../project.mjs';
import {createTaskLeaseManager, ProjectBusyError} from '../task-lease.mjs';

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const AUDIO_EXTS = new Set(['.mp3', '.m4a', '.wav', '.flac', '.aac', '.ogg']);
const VIDEO_EXTS = new Set(['.mp4', '.mov', '.avi', '.mkv', '.webm', '.m4v']);
const STEM_RE = /^[^/\\\0]+$/;
const locks = new Set();
const undoRecords = new Map();

export class AssetMutationError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

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
  if (isJobRunning?.()) throw new AssetMutationError(409, '任务运行中，不能修改文件');
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

const assertManageable = (folder, asset) => {
  if (asset.kind === 'lyrics') throw new AssetMutationError(409, '歌词文件此批只读；音频操作仅联动同 stem 歌词');
};

const invalidateDerived = (folder, operationDir, kind) => {
  if (kind !== 'photo' && kind !== 'audio') return [];
  const paths = resolveProjectPaths(folder);
  const names = kind === 'photo'
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

const trashDir = (folder, id) => path.join(folder, '.tsuzuri-trash', id);

const assertCanonicalDirectory = (directory, folder, message) => {
  let stat;
  try { stat = fs.lstatSync(directory); } catch { throw new AssetMutationError(409, message); }
  if (!stat.isDirectory() || stat.isSymbolicLink() || fs.realpathSync(directory) !== directory || !inside(folder, directory)) {
    throw new AssetMutationError(409, message);
  }
};

const createOperationDir = (folder, id) => {
  const root = path.join(folder, '.tsuzuri-trash');
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
  const root = path.join(record.folder, '.tsuzuri-trash');
  if (record.operationDir !== trashDir(record.folder, record.id) || !inside(root, record.operationDir)) {
    throw new AssetMutationError(409, '回收记录路径已变化');
  }
  if (pathExists(root)) assertCanonicalDirectory(root, record.folder, '回收记录路径已变化');
  if (pathExists(record.operationDir)) {
    assertCanonicalDirectory(record.operationDir, record.folder, '回收记录路径已变化');
    const manifestPath = operationPath(record.operationDir, 'manifest.json');
    let manifest;
    try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch { throw new AssetMutationError(409, '回收记录已变化，不能清理'); }
    const expectedConfig = record.config ? {
      path: path.relative(record.folder, record.config.jsonPath),
      backup: path.relative(record.operationDir, record.config.backupPath),
    } : null;
    if (manifest.id !== record.id || manifest.action !== record.action || !Array.isArray(manifest.files) || !Array.isArray(manifest.derived)
      || JSON.stringify(manifest.files) !== JSON.stringify(record.files.map((move) => relativeMove(record.folder, record.operationDir, move)))
      || JSON.stringify(manifest.derived) !== JSON.stringify(record.derived.map((move) => relativeMove(record.folder, record.operationDir, move)))
      || JSON.stringify(manifest.config ?? null) !== JSON.stringify(expectedConfig)) {
      throw new AssetMutationError(409, '回收记录已变化，不能清理');
    }
    const expectedFiles = new Set(['manifest.json']);
    const restoredPaths = new Set();
    const addOperationPath = (relative, destination) => {
      if (typeof relative !== 'string' || !relative || path.isAbsolute(relative)) throw new AssetMutationError(409, '回收记录已变化，不能清理');
      const target = operationPath(record.operationDir, relative);
      if (path.relative(record.operationDir, target) !== relative || !inside(record.operationDir, target)) throw new AssetMutationError(409, '回收记录已变化，不能清理');
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
        if (stat.isSymbolicLink()) throw new AssetMutationError(409, '回收记录已变化，不能清理');
        if (stat.isDirectory()) {
          if (!expectedDirs.has(childRelative)) throw new AssetMutationError(409, '回收记录已变化，不能清理');
          walk(child, childRelative);
        } else if (!stat.isFile() || !expectedFiles.has(childRelative)) throw new AssetMutationError(409, '回收记录已变化，不能清理');
      }
    };
    walk(record.operationDir);
    for (const relative of expectedFiles) {
      const stat = fs.lstatSync(operationPath(record.operationDir, relative));
      if (!stat.isFile() || stat.isSymbolicLink()) throw new AssetMutationError(409, '回收记录已变化，不能清理');
    }
    for (const relative of restoredPaths) {
      if (pathExists(operationPath(record.operationDir, relative))) throw new AssetMutationError(409, '回收记录已变化，不能清理');
    }
    fs.rmSync(record.operationDir, {recursive: true});
  }
  try { fs.rmdirSync(root); } catch (error) { if (error.code !== 'ENOTEMPTY' && error.code !== 'ENOENT') throw error; }
};

const withMutationLease = (folder, task, leaseManager = createTaskLeaseManager()) => {
  let lease;
  try {
    lease = leaseManager.acquire({kind: 'asset-mutation', resources: [folder]});
    return withProjectMutationLock(folder, task);
  } catch (error) {
    if (error instanceof ProjectBusyError) throw new AssetMutationError(409, '项目已有任务在执行');
    throw error;
  } finally {
    if (lease) leaseManager.release(lease);
  }
};

export const mutateAsset = ({folder, assetId, action, stem: newStem, isJobRunning, leaseManager}) => withMutationLease(folder, (canonicalFolder) => {
  folder = canonicalFolder;
  assertNoRunningJob(isJobRunning);
  const asset = resolveAsset(folder, assetId);
  assertManageable(folder, asset);
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
          const backupPath = operationPath(operationDir, 'metadata', 'tsuzuri.json');
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
    undoRecords.set(id, {id, action, folder, operationDir, files: changes.map((change) => ({...change, storedInOperation: false})), derived, config: configBackup});
    return {assetId: `${asset.kind}:${path.relative(folder, destination)}`, name, undoId: id};
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
  undoRecords.set(id, {id, action, folder, operationDir, files: changes.map((change) => ({...change, storedInOperation: true})), derived, config: null});
  return {undoId: id};
}, leaseManager);

export const undoAssetDelete = ({folder, undoId, isJobRunning, leaseManager}) => withMutationLease(folder, (canonicalFolder) => {
  folder = canonicalFolder;
  assertNoRunningJob(isJobRunning);
  if (typeof undoId !== 'string' || !/^[0-9a-f-]{36}$/i.test(undoId)) throw new AssetMutationError(400, 'undoId 无效');
  const record = undoRecords.get(undoId);
  if (!record || record.folder !== folder) throw new AssetMutationError(404, '撤销记录不存在（服务重启后不可撤销）');
  if (record.restored) {
    try { removeOperationDir(record); } catch (error) {
      if (error instanceof AssetMutationError) throw error;
      throw new AssetMutationError(500, '文件已恢复，但回收记录尚未清理');
    }
    undoRecords.delete(undoId);
    return {restored: 0};
  }
  if (record.action !== 'rename' && record.action !== 'delete') throw new AssetMutationError(409, '回收记录或目标路径已变化');
  const files = record.files.map((change) => {
    if (typeof change.storedInOperation !== 'boolean' || (record.action === 'rename' ? change.storedInOperation : !change.storedInOperation)) {
      throw new AssetMutationError(409, '回收记录或目标路径已变化');
    }
    return change;
  });
  const changes = [
    ...files,
    ...record.derived.map(({source, destination}) => ({from: source, to: destination, storedInOperation: true})),
  ];
  for (const change of changes) {
    // Rename files remain in the project under their new names; only deleted files,
    // derived metadata, and config backups are stored in the operation directory.
    const source = change.to;
    const target = change.from;
    const sourceRoot = change.storedInOperation ? record.operationDir : folder;
    if (!inside(sourceRoot, source) || !inside(folder, target) || fs.existsSync(target)) throw new AssetMutationError(409, '原位置已被占用，不能撤销');
    try {
      const sourceStat = fs.lstatSync(source);
      const sourceParent = path.dirname(source);
      const targetParent = path.dirname(target);
      if (!sourceStat.isFile() || sourceStat.isSymbolicLink() || fs.lstatSync(sourceParent).isSymbolicLink() || fs.lstatSync(targetParent).isSymbolicLink()) throw new Error('link');
      if (fs.realpathSync(source) !== source || fs.realpathSync(sourceParent) !== sourceParent || fs.realpathSync(targetParent) !== targetParent) throw new Error('drift');
    } catch { throw new AssetMutationError(409, '回收记录或目标路径已变化'); }
  }
  if (record.config) {
    const backupPath = record.config.backupPath;
    try {
      if (!inside(record.operationDir, backupPath) || !inside(folder, record.config.jsonPath) || !fs.lstatSync(backupPath).isFile() || fs.lstatSync(backupPath).isSymbolicLink() || !fs.lstatSync(record.config.jsonPath).isFile() || fs.lstatSync(record.config.jsonPath).isSymbolicLink()) throw new Error('link');
      if (fs.realpathSync(backupPath) !== backupPath || fs.realpathSync(path.dirname(backupPath)) !== path.dirname(backupPath) || fs.realpathSync(record.config.jsonPath) !== record.config.jsonPath || fs.realpathSync(path.dirname(record.config.jsonPath)) !== path.dirname(record.config.jsonPath)) throw new Error('drift');
    } catch { throw new AssetMutationError(409, '回收记录或目标路径已变化'); }
  }
  const reverse = changes.map(({from, to}) => ({from: to, to: from}));
  try {
    for (const change of reverse) move(change.from, change.to);
    if (record.config) restoreConfig(record.config);
  } catch (error) { rollbackForwardMoves(reverse); throw error; }
  record.restored = true;
  try { removeOperationDir(record); } catch (error) {
    if (error instanceof AssetMutationError) throw error;
    throw new AssetMutationError(500, '文件已恢复，但回收记录尚未清理');
  }
  undoRecords.delete(undoId);
  return {restored: reverse.length};
}, leaseManager);
