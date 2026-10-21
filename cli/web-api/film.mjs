import path from 'node:path';

import {filmSettingsPathFor, readFilmSettings, updateFilmSettings, writeFilmSettings} from '../film-settings.mjs';
import {scanFolderLoose} from '../project.mjs';
import {createTaskLeaseManager, ProjectBusyError} from '../task-lease.mjs';
import {CaptionRequestError, assertCanonicalPath, canonicalProject} from './captions.mjs';

export class FilmRequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

const withFilmErrors = (action) => {
  try {
    return action();
  } catch (error) {
    if (error instanceof CaptionRequestError) throw new FilmRequestError(error.status, error.message);
    throw error;
  }
};

export const assertSafeFilmPath = (folder, filmPath) => withFilmErrors(() => assertCanonicalPath(folder, filmPath, {
  file: true,
  allowMissing: true,
  message: '胶卷设置路径不安全或已变化',
}));

const resolvePhotoKey = (folder, assetId) => {
  if (typeof assetId !== 'string' || !assetId.startsWith('photo:')) {
    throw new FilmRequestError(400, '只能为素材照片设置胶卷');
  }
  const relativePath = assetId.slice('photo:'.length);
  if (!scanFolderLoose(folder).photos.includes(relativePath)) throw new FilmRequestError(404, '找不到这张照片');
  withFilmErrors(() => assertCanonicalPath(folder, path.join(folder, relativePath), {
    file: true,
    message: '照片路径不安全或已变化',
  }));
  return relativePath;
};

const buildPatch = (folder, {roll, strength, photo}) => {
  const patch = {};
  if (roll !== undefined) patch.roll = roll;
  if (strength !== undefined) patch.strength = strength;
  if (photo !== undefined) {
    if (!isPlainObject(photo)) throw new FilmRequestError(400, 'photo 格式不对');
    patch.photo = {
      path: resolvePhotoKey(folder, photo.assetId),
      ...(photo.roll !== undefined ? {roll: photo.roll} : {}),
      ...(photo.strength !== undefined ? {strength: photo.strength} : {}),
      ...(photo.inherit !== undefined ? {inherit: photo.inherit} : {}),
    };
  }
  if (Object.keys(patch).length === 0) throw new FilmRequestError(400, '没有要修改的胶卷设置');
  return patch;
};

const releaseFilmLease = (leaseManager, lease, operationFailed) => {
  if (!lease) return;
  let released = false;
  try { released = leaseManager.release(lease) === true; } catch (error) { if (!operationFailed) throw error; }
  if (!released && !operationFailed) throw new Error('任务 lease 释放失败');
};

export const saveFilmSettings = async ({
  folder,
  roll,
  strength,
  photo,
  isJobRunning,
  signal,
  leaseManager = createTaskLeaseManager(),
}) => {
  folder = withFilmErrors(() => canonicalProject(folder));
  let lease;
  try {
    lease = leaseManager.acquire({kind: 'film', resources: [folder]});
  } catch (error) {
    if (error instanceof ProjectBusyError) throw new FilmRequestError(409, '项目已有任务在执行');
    throw error;
  }
  let operationFailed = false;
  try {
    if (isJobRunning?.()) throw new FilmRequestError(409, '任务运行中,不能修改胶卷');
    if (signal?.aborted) throw new FilmRequestError(499, '胶卷设置已取消');
    const patch = buildPatch(folder, {roll, strength, photo});
    const filmPath = filmSettingsPathFor(folder);
    assertSafeFilmPath(folder, filmPath);
    let next;
    try {
      next = updateFilmSettings(readFilmSettings(filmPath), patch);
    } catch (error) {
      if (error instanceof TypeError) throw new FilmRequestError(400, error.message);
      throw error;
    }
    assertSafeFilmPath(folder, filmPath);
    return writeFilmSettings(filmPath, next);
  } catch (error) {
    operationFailed = true;
    if (error instanceof FilmRequestError) throw error;
    if (error instanceof ProjectBusyError) throw new FilmRequestError(409, '项目已有任务在执行');
    throw error;
  } finally {
    releaseFilmLease(leaseManager, lease, operationFailed);
  }
};
