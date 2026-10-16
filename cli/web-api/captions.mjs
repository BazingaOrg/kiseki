import fs from 'node:fs';
import path from 'node:path';

import {requireCaptionApiKey, preparePhotoCaptions} from '../ai/photo-caption-service.mjs';
import {cacheHit, captionsPathFor, loadCaptionCache, readCaptionCacheState, upsertCaptionItem, writeCaptionCache} from '../ai/photo-caption-cache.mjs';
import {PREVIEW_WIDTH, captionSourceIdentity, readSourceStat, sourceIdentityRecord} from '../image-identity.mjs';
import {normalizeCaptionHint, normalizeManualCaption} from '../ai/photo-caption-prompt.mjs';
import {CliError} from '../options.mjs';
import {scanFolderLoose} from '../project.mjs';
import {createTaskLeaseManager, ProjectBusyError} from '../task-lease.mjs';

export class CaptionRequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const inside = (root, target) => target === root || target.startsWith(root + path.sep);

const canonicalProject = (folder) => {
  if (typeof folder !== 'string' || !folder || folder.includes('\0')) throw new CaptionRequestError(403, '路径越界或无效');
  let stat;
  try { stat = fs.lstatSync(folder); } catch { throw new CaptionRequestError(400, 'folder 不是一个存在的目录'); }
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new CaptionRequestError(400, 'folder 不是一个存在的目录');
  const resolved = path.resolve(folder);
  let real;
  try { real = fs.realpathSync.native(resolved); } catch { throw new CaptionRequestError(400, 'folder 不是一个存在的目录'); }
  if (real !== resolved) throw new CaptionRequestError(403, '项目路径不安全或已变化');
  return real;
};

const assertCanonicalPath = (root, target, {file = false, allowMissing = false, message}) => {
  const resolved = path.resolve(target);
  if (!inside(root, resolved)) throw new CaptionRequestError(403, message);
  const relative = path.relative(root, resolved);
  let cursor = root;
  const parts = relative ? relative.split(path.sep) : [];
  for (let index = 0; index < parts.length; index += 1) {
    cursor = path.join(cursor, parts[index]);
    let stat;
    try { stat = fs.lstatSync(cursor); } catch (error) {
      if (allowMissing && error?.code === 'ENOENT') return resolved;
      throw new CaptionRequestError(409, message);
    }
    const final = index === parts.length - 1;
    if (stat.isSymbolicLink() || (final && file ? !stat.isFile() : !stat.isDirectory())) {
      throw new CaptionRequestError(409, message);
    }
    let real;
    try { real = fs.realpathSync.native(cursor); } catch { throw new CaptionRequestError(409, message); }
    if (real !== cursor || !inside(root, real)) throw new CaptionRequestError(409, message);
  }
  return resolved;
};

export const assertSafeCachePath = (folder, cachePath) => assertCanonicalPath(folder, cachePath, {
  file: true,
  allowMissing: true,
  message: '旁白缓存路径不安全或已变化',
});

const resolvePhotoAsset = (folder, assetId) => {
  if (typeof assetId !== 'string' || !assetId.startsWith('photo:')) {
    throw new CaptionRequestError(400, '只能为素材照片生成旁白');
  }
  const relativePath = assetId.slice('photo:'.length);
  const photos = scanFolderLoose(folder).photos;
  if (!photos.includes(relativePath)) throw new CaptionRequestError(404, '找不到这张照片');
  const absPath = assertCanonicalPath(folder, path.join(folder, relativePath), {
    file: true,
    message: '照片路径不安全或已变化',
  });
  return {relativePath, absPath};
};

const releaseCaptionLease = (leaseManager, lease, operationFailed) => {
  if (!lease) return;
  let released = false;
  try { released = leaseManager.release(lease) === true; } catch (error) { if (!operationFailed) throw error; }
  if (!released && !operationFailed) throw new Error('任务 lease 释放失败');
};

export const savePhotoCaption = async ({
  folder,
  assetId,
  text = '',
  isJobRunning,
  signal,
  leaseManager = createTaskLeaseManager(),
}) => {
  folder = canonicalProject(folder);
  let lease;
  try {
    lease = leaseManager.acquire({kind: 'caption', resources: [folder]});
  } catch (error) {
    if (error instanceof ProjectBusyError) throw new CaptionRequestError(409, '项目已有任务在执行');
    throw error;
  }
  let operationFailed = false;
  try {
    if (isJobRunning?.()) throw new CaptionRequestError(409, '任务运行中,不能修改旁白');
    if (signal?.aborted) throw new CaptionRequestError(499, '图片旁白已取消');
    const normalized = normalizeManualCaption(text);
    if (!normalized.ok) throw new CaptionRequestError(400, normalized.error);
    const {relativePath, absPath} = resolvePhotoAsset(folder, assetId);
    const cachePath = captionsPathFor(folder);
    assertSafeCachePath(folder, cachePath);
    const stat = readSourceStat(absPath);
    if (!stat) throw new CaptionRequestError(404, '找不到这张照片');
    const cache = loadCaptionCache(cachePath);
    const hit = cacheHit(cache, relativePath, sourceIdentityRecord(relativePath, stat, PREVIEW_WIDTH));
    if (!hit) throw new CaptionRequestError(409, '先生成这句旁白，再改字');
    const stored = {...hit, text: normalized.text, edited: true};
    writeCaptionCache(cachePath, upsertCaptionItem(cache, relativePath, stored));
    const hintText = typeof hit.hint === 'string' && hit.hint.trim() ? hit.hint.trim() : '';
    return {
      caption: normalized.text,
      captionEdited: true,
      ...(hintText ? {captionHint: hintText} : {}),
    };
  } catch (error) {
    operationFailed = true;
    if (error instanceof CaptionRequestError) throw error;
    if (error instanceof ProjectBusyError) throw new CaptionRequestError(409, '项目已有任务在执行');
    throw error;
  } finally {
    releaseCaptionLease(leaseManager, lease, operationFailed);
  }
};

export const clearPhotoCaptions = async ({
  folder,
  expectedRevision,
  expectedFingerprint,
  isJobRunning,
  signal,
  leaseManager = createTaskLeaseManager(),
}) => {
  folder = canonicalProject(folder);
  let lease;
  try {
    lease = leaseManager.acquire({kind: 'caption-clear', resources: [folder]});
  } catch (error) {
    if (error instanceof ProjectBusyError) throw new CaptionRequestError(409, '项目已有任务在执行');
    throw error;
  }
  let operationFailed = false;
  try {
    if (isJobRunning?.()) throw new CaptionRequestError(409, '任务运行中,不能清空旁白');
    if (signal?.aborted) throw new CaptionRequestError(499, '清空图片旁白已取消');
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || !(expectedFingerprint === null || /^[a-f0-9]{64}$/.test(expectedFingerprint))) throw new CaptionRequestError(400, '缺少旁白版本，请刷新后重试');
    const cachePath = captionsPathFor(folder);
    const exists = fs.existsSync(cachePath);
    if (exists) assertSafeCachePath(folder, cachePath);
    const state = readCaptionCacheState(cachePath);
    const cache = state.cache;
    if (state.fingerprint !== expectedFingerprint || Number(cache.revision ?? 0) !== expectedRevision) throw new CaptionRequestError(409, '旁白已有更新，请刷新后重新确认');
    if (!exists) return {cleared: 0};
    const cleared = state.itemCount;
    writeCaptionCache(cachePath, {...cache, revision: Number(cache.revision ?? 0) + 1, items: {}});
    return {cleared};
  } catch (error) {
    operationFailed = true;
    if (error instanceof CaptionRequestError) throw error;
    if (error instanceof ProjectBusyError) throw new CaptionRequestError(409, '项目已有任务在执行');
    throw error;
  } finally {
    releaseCaptionLease(leaseManager, lease, operationFailed);
  }
};

export const generatePhotoCaption = async ({
  folder,
  assetId,
  hint = '',
  isJobRunning,
  signal,
  leaseManager = createTaskLeaseManager(),
  prepare = preparePhotoCaptions,
  getApiKey = requireCaptionApiKey,
}) => {
  folder = canonicalProject(folder);
  let lease;
  try {
    lease = leaseManager.acquire({kind: 'caption', resources: [folder]});
  } catch (error) {
    if (error instanceof ProjectBusyError) throw new CaptionRequestError(409, '项目已有任务在执行');
    throw error;
  }
  let operationFailed = false;
  try {
    if (isJobRunning?.()) throw new CaptionRequestError(409, '任务运行中,不能生成旁白');
    if (signal?.aborted) throw new CaptionRequestError(499, '图片旁白已取消');
    const {relativePath, absPath} = resolvePhotoAsset(folder, assetId);
    const cachePath = captionsPathFor(folder);
    assertSafeCachePath(folder, cachePath);
    const before = readSourceStat(absPath);
    if (!before) throw new CaptionRequestError(404, '找不到这张照片');
    const identityKey = captionSourceIdentity(relativePath, before, PREVIEW_WIDTH);
    let apiKey;
    try {
      apiKey = getApiKey();
    } catch (error) {
      const message = error instanceof CliError ? error.message : '图片旁白尚未配置';
      throw new CaptionRequestError(400, message);
    }
    const captionHint = normalizeCaptionHint(hint);
    const prepared = await prepare({
      projectRoot: folder,
      sources: [{absPath, key: relativePath}],
      apiKey,
      force: true,
      hint: captionHint,
      signal,
      cachePath,
    });
    assertCanonicalPath(folder, absPath, {file: true, message: '照片路径不安全或已变化'});
    assertSafeCachePath(folder, cachePath);
    const after = readSourceStat(absPath);
    if (!after || captionSourceIdentity(relativePath, after, PREVIEW_WIDTH) !== identityKey) {
      throw new CaptionRequestError(409, '照片已变化，请重新制作');
    }
    const text = prepared.results.get(relativePath)?.text;
    if (typeof text !== 'string' || !text.trim()) throw new CaptionRequestError(500, '图片旁白生成失败');
    return {
      caption: text.trim(),
      ...(captionHint ? {captionHint} : {}),
    };
  } catch (error) {
    operationFailed = true;
    if (error instanceof CaptionRequestError) throw error;
    if (error instanceof ProjectBusyError) throw new CaptionRequestError(409, '项目已有任务在执行');
    if (error?.code === 'cancelled' || error?.name === 'AbortError') throw new CaptionRequestError(499, '图片旁白已取消');
    if (error?.code === 'source-changed') throw new CaptionRequestError(409, error.message);
    throw error;
  } finally {
    releaseCaptionLease(leaseManager, lease, operationFailed);
  }
};
