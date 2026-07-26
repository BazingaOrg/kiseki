/** 受限的单文件资产操作；这里不是通用文件管理器。 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import {renamePerPhotoConfig, resolveProjectPaths, scanFolderLoose} from '../project.mjs';

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
    const destination = path.join(operationDir, 'derived', path.basename(source));
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

export const mutateAsset = ({folder, assetId, action, stem: newStem, isJobRunning}) => withProjectMutationLock(folder, () => {
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
    try {
      if (asset.kind === 'photo') {
        try { configBackup = renamePerPhotoConfig(folder, path.basename(asset.target), name); } catch (error) {
          throw new AssetMutationError(409, error.message);
        }
      }
      for (const change of changes) move(change.from, change.to);
      const op = trashDir(folder, `invalidate-${crypto.randomUUID()}`);
      derived = invalidateDerived(folder, op, asset.kind);
    } catch (error) {
      rollbackForwardMoves(changes);
      for (const entry of [...derived].reverse()) {
        try { if (fs.existsSync(entry.destination) && !fs.existsSync(entry.source)) move(entry.destination, entry.source); } catch {}
      }
      if (configBackup) fs.writeFileSync(configBackup.jsonPath, configBackup.rawText, 'utf8');
      throw error;
    }
    return {assetId: `${asset.kind}:${path.relative(folder, destination)}`, name};
  }
  if (action !== 'delete') throw new AssetMutationError(400, '不支持的操作');
  const id = crypto.randomUUID();
  const operationDir = trashDir(folder, id);
  const pair = asset.kind === 'audio' ? pairedLyrics(folder, asset) : [];
  const items = [asset, ...pair];
  const changes = items.map((item) => ({from: item.target, to: path.join(operationDir, 'files', item.relativePath)}));
  let derived = [];
  try {
    for (const change of changes) fs.mkdirSync(path.dirname(change.to), {recursive: true});
    for (const change of changes) move(change.from, change.to);
    derived = invalidateDerived(folder, operationDir, asset.kind);
    fs.writeFileSync(path.join(operationDir, 'manifest.json'), `${JSON.stringify({version: 1, id, files: changes.map(({from, to}) => ({from: path.relative(folder, from), to: path.relative(operationDir, to)})), derived}, null, 2)}\n`);
  } catch (error) {
    rollbackForwardMoves(changes);
    for (const entry of [...derived].reverse()) {
      try { if (fs.existsSync(entry.destination) && !fs.existsSync(entry.source)) move(entry.destination, entry.source); } catch {}
    }
    throw error;
  }
  undoRecords.set(id, {folder: fs.realpathSync(folder), operationDir, files: changes, derived});
  return {undoId: id};
});

export const undoAssetDelete = ({folder, undoId, isJobRunning}) => withProjectMutationLock(folder, () => {
  assertNoRunningJob(isJobRunning);
  if (typeof undoId !== 'string' || !/^[0-9a-f-]{36}$/i.test(undoId)) throw new AssetMutationError(400, 'undoId 无效');
  const record = undoRecords.get(undoId);
  if (!record || record.folder !== fs.realpathSync(folder)) throw new AssetMutationError(404, '撤销记录不存在（服务重启后不可撤销）');
  const changes = [...record.files, ...record.derived.map(({source, destination}) => ({from: source, to: destination}))];
  const expectedRoot = path.join(record.operationDir);
  for (const change of changes) {
    // records store forward moves; undo source is their trusted trash destination.
    const source = change.to;
    const target = change.from;
    if (!inside(expectedRoot, source) || !inside(folder, target) || fs.existsSync(target)) throw new AssetMutationError(409, '原位置已被占用，不能撤销');
    try {
      if (fs.lstatSync(source).isSymbolicLink() || fs.lstatSync(path.dirname(source)).isSymbolicLink() || fs.lstatSync(path.dirname(target)).isSymbolicLink()) throw new Error('link');
      if (fs.realpathSync(path.dirname(source)) !== path.dirname(source) || fs.realpathSync(path.dirname(target)) !== path.dirname(target)) throw new Error('drift');
    } catch { throw new AssetMutationError(409, '回收记录或目标路径已变化'); }
  }
  const reverse = changes.map(({from, to}) => ({from: to, to: from}));
  try {
    for (const change of reverse) move(change.from, change.to);
  } catch (error) { rollbackForwardMoves(reverse); throw error; }
  undoRecords.delete(undoId);
  return {restored: reverse.length};
});
