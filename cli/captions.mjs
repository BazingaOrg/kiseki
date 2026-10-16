import fs from 'node:fs';
import path from 'node:path';

import {withProcessAbort, emitCaptionFailure} from './ai/caption-runtime.mjs';
import {cacheHit, captionsPathFor, loadCaptionCache} from './ai/photo-caption-cache.mjs';
import {preparePhotoCaptions, requireCaptionApiKey} from './ai/photo-caption-service.mjs';
import {normalizePhotoKey} from './ai/photo-key.mjs';
import {CliError} from './options.mjs';
import {PREVIEW_WIDTH, readSourceStat, sourceIdentityRecord} from './image-identity.mjs';
import {createPercentProgress} from './progress.mjs';
import {ensureProjectDirs, resolveProjectPaths, scanFolderLoose} from './project.mjs';
import {acquireCommandLease, createTaskLeaseManager} from './task-lease.mjs';
import {term} from './term.mjs';
import {assertSafeCachePath} from './web-api/captions.mjs';

export const runCaptions = async (folderArg, {prepare = preparePhotoCaptions, getApiKey = requireCaptionApiKey, leaseManager = createTaskLeaseManager()} = {}) => {
  const folder = path.resolve(folderArg);
  if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) throw new CliError(`不是文件夹: ${folder}`);
  if (fs.lstatSync(folder).isSymbolicLink() || fs.realpathSync.native(folder) !== folder) throw new CliError('项目路径不安全或已变化');
  const photos = scanFolderLoose(folder).photos.filter((name) => {
    const source = path.join(folder, name);
    const stat = fs.lstatSync(source);
    return stat.isFile() && !stat.isSymbolicLink() && fs.realpathSync.native(source) === source;
  });
  if (photos.length === 0) throw new CliError('素材夹里还没有照片');
  const originalKey = process.env.DEEPSEEK_API_KEY;
  delete process.env.DEEPSEEK_API_KEY;
  let task;
  let originalEnv;
  let progress;
  try {
    const cachePath = captionsPathFor(folder);
    task = acquireCommandLease({kind: 'captions', folder, outputPaths: [cachePath], manager: leaseManager});
    originalEnv = Object.fromEntries(Object.keys(task.env).map((key) => [key, process.env[key]]));
    Object.assign(process.env, task.env);
    assertSafeCachePath(folder, cachePath);
    ensureProjectDirs(resolveProjectPaths(folder));
    assertSafeCachePath(folder, cachePath);
    const cache = loadCaptionCache(cachePath);
    const sources = photos.map((name) => ({absPath: path.join(folder, name), key: normalizePhotoKey(folder, name)}));
    const missing = sources.filter(({absPath, key}) => {
      const stat = readSourceStat(absPath);
      if (!stat) throw new CliError('照片已变化，请重新制作');
      return !cacheHit(cache, key, sourceIdentityRecord(key, stat, PREVIEW_WIDTH));
    });
    const captionTask = term.task('准备图片旁白');
    progress = createPercentProgress();
    try {
      captionTask.endLine();
      if (missing.length === 0) {
        captionTask.succeed();
        term.detail(`${photos.length} 张照片的旁白已备齐`);
        return 0;
      }
      if (originalKey !== undefined) process.env.DEEPSEEK_API_KEY = originalKey;
      const apiKey = getApiKey();
      delete process.env.DEEPSEEK_API_KEY;
      const prepared = await withProcessAbort((signal) => prepare({
        projectRoot: folder,
        sources: missing,
        apiKey,
        signal,
        onProgress: ({completed, total, reused, generated}) => {
          progress.update('Photo captions', total === 0 ? 1 : completed / total, 'Photo captions', {completed, total, reused, generated});
        },
      }));
      captionTask.succeed();
      term.detail(`已有 ${photos.length - missing.length} 条，新生成 ${prepared.generated} 条`);
      return 0;
    } catch (error) {
      captionTask.fail();
      emitCaptionFailure(error);
      throw error;
    }
  } finally {
    progress?.finish();
    if (originalEnv) {
      for (const [key, value] of Object.entries(originalEnv)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
    try {
      if (task && !task.inherited) task.manager.release(task.lease);
    } finally {
      if (originalKey === undefined) delete process.env.DEEPSEEK_API_KEY;
      else process.env.DEEPSEEK_API_KEY = originalKey;
    }
  }
};
