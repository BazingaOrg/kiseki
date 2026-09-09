import path from 'node:path';

import {CliError} from '../options.mjs';
import {
  PREVIEW_WIDTH,
  captionSourceIdentity,
  identityRecordKey,
  readSourceStat,
  sourceIdentityRecord,
} from '../image-identity.mjs';
import {materializeAiPreview} from '../preview-jpeg.mjs';
import {requestCaption, CaptionHttpError} from './deepseek-vision-client.mjs';
import {
  cacheHit,
  captionsPathFor,
  createSerialWriter,
  loadCaptionCache,
  upsertCaptionItem,
} from './photo-caption-cache.mjs';
import {normalizePhotoKey} from './photo-key.mjs';
import {CAPTION_MODEL, promptHash} from './photo-caption-prompt.mjs';

export const CAPTION_REQUEST_CONCURRENCY = 4;
export const CAPTION_ATTEMPT_BUDGET = 3;

const delay = (ms, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) {
    reject(Object.assign(new Error('cancelled'), {code: 'cancelled'}));
    return;
  }
  const timer = setTimeout(resolve, ms);
  const onAbort = () => {
    clearTimeout(timer);
    reject(Object.assign(new Error('cancelled'), {code: 'cancelled'}));
  };
  signal?.addEventListener('abort', onAbort, {once: true});
});

const backoffMs = (attempt) => 400 * (2 ** attempt) + Math.floor(Math.random() * 200);

export const requireCaptionApiKey = (env = process.env) => {
  const key = typeof env.DEEPSEEK_API_KEY === 'string' ? env.DEEPSEEK_API_KEY.trim() : '';
  if (!key) {
    throw new CliError('图片旁白尚未配置\n设置 DEEPSEEK_API_KEY 后重新打开工作台，或关闭图片旁白继续制作。');
  }
  return key;
};

const createLimiter = (limit) => {
  let active = 0;
  const waiters = [];
  const acquire = () => {
    if (active < limit) {
      active += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => waiters.push(resolve)).then(() => {
      active += 1;
    });
  };
  const release = () => {
    active -= 1;
    const next = waiters.shift();
    if (next) next();
  };
  return {acquire, release, get active() { return active; }};
};

const changedError = () => Object.assign(new Error('照片已变化，请重新制作'), {code: 'source-changed', failureStage: 'photo-caption'});

export const preparePhotoCaptions = async ({
  projectRoot,
  sources,
  apiKey,
  signal,
  generateCaption = requestCaption,
  materialize = materializeAiPreview,
  readStat = readSourceStat,
  now = Date.now,
  onProgress,
  cachePath = captionsPathFor(projectRoot),
} = {}) => {
  const started = now();
  const local = new AbortController();
  const abortLocal = () => local.abort();
  signal?.addEventListener('abort', abortLocal, {once: true});
  const workSignal = local.signal;
  let cache = loadCaptionCache(cachePath);
  const writer = createSerialWriter();
  const limiter = createLimiter(CAPTION_REQUEST_CONCURRENCY);
  const required = [];
  const seen = new Set();

  for (const source of sources) {
    const absPath = source.absPath ?? source;
    const key = source.key ?? normalizePhotoKey(projectRoot, absPath);
    if (!key) throw Object.assign(new Error('图片路径越界或无效'), {code: 'path', failureStage: 'photo-caption'});
    if (seen.has(key)) continue;
    seen.add(key);
    required.push({absPath: path.resolve(absPath), key});
  }

  const total = required.length;
  let completed = 0;
  let reused = 0;
  let generated = 0;
  const report = () => onProgress?.({completed, total, reused, generated});

  const prepareOne = async (entry) => {
    if (workSignal.aborted) throw Object.assign(new Error('cancelled'), {code: 'cancelled', failureStage: 'photo-caption'});
    const before = readStat(entry.absPath);
    if (!before) throw Object.assign(new Error('找不到照片'), {code: 'missing', failureStage: 'photo-caption'});
    const identity = sourceIdentityRecord(entry.key, before, PREVIEW_WIDTH);
    const identityKey = captionSourceIdentity(entry.key, before, PREVIEW_WIDTH);
    const hit = cacheHit(cache, entry.key, identity);
    if (hit) {
      reused += 1;
      completed += 1;
      report();
      return {key: entry.key, text: hit.text, reused: true, identity, preview: null};
    }

    const preview = await materialize(entry.absPath, identityKey, {signal: workSignal});
    const afterEncode = readStat(entry.absPath);
    if (!afterEncode || captionSourceIdentity(entry.key, afterEncode, PREVIEW_WIDTH) !== identityKey) {
      throw changedError();
    }

    let repairReason = null;
    let lastValidation = null;
    for (let attempt = 0; attempt < CAPTION_ATTEMPT_BUDGET; attempt += 1) {
      if (workSignal.aborted) throw Object.assign(new Error('cancelled'), {code: 'cancelled', failureStage: 'photo-caption'});
      let retry = false;
      await limiter.acquire();
      try {
        const result = await generateCaption({
          jpegBuffer: preview.buffer,
          apiKey,
          signal: workSignal,
          repairReason,
        });
        lastValidation = result.validation;
        if (result.validation.ok) {
          const beforeWrite = readStat(entry.absPath);
          if (!beforeWrite || captionSourceIdentity(entry.key, beforeWrite, PREVIEW_WIDTH) !== identityKey) {
            throw changedError();
          }
          const stored = {
            source_identity: identity,
            preview_sha256: preview.sha256,
            preview_pixel_width: preview.width,
            preview_pixel_height: preview.height,
            text: result.validation.text,
            usage: result.usage,
          };
          cache = upsertCaptionItem(cache, entry.key, stored);
          await writer.enqueue(cachePath, cache);
          generated += 1;
          completed += 1;
          report();
          return {key: entry.key, text: stored.text, reused: false, identity, preview};
        }
        if (repairReason) break;
        repairReason = result.validation.reason;
        retry = attempt < CAPTION_ATTEMPT_BUDGET - 1;
      } catch (error) {
        if (error instanceof CaptionHttpError && error.batchFatal) {
          local.abort();
          error.failureStage = 'photo-caption';
          throw error;
        }
        if (error instanceof CaptionHttpError && !error.retryable) {
          error.failureStage = 'photo-caption';
          throw error;
        }
        if (error instanceof CaptionHttpError && error.retryable && attempt < CAPTION_ATTEMPT_BUDGET - 1) {
          retry = true;
        } else {
          throw error;
        }
      } finally {
        limiter.release();
      }
      if (retry) await delay(backoffMs(attempt), workSignal);
    }
    throw Object.assign(new Error(lastValidation ? `文案未通过校验: ${lastValidation.reason}` : '图片旁白生成失败'), {
      code: 'caption-invalid',
      failureStage: 'photo-caption',
    });
  };

  const results = new Map();
  try {
    const pending = required.map((entry) => prepareOne(entry).then((result) => {
      results.set(result.key, result);
      return result;
    }));
    const outcomes = await Promise.allSettled(pending);
    await writer.drain();
    const rejected = outcomes.filter((outcome) => outcome.status === 'rejected');
    const fatal = rejected.find((outcome) => outcome.reason instanceof CaptionHttpError && outcome.reason.batchFatal);
    if (fatal) throw fatal.reason;
    if (workSignal.aborted) {
      throw Object.assign(new Error('cancelled'), {code: 'cancelled', failureStage: 'photo-caption'});
    }
    if (rejected.length > 0) throw rejected[0].reason;
    const snapshot = loadCaptionCache(cachePath);
    if (snapshot.model !== CAPTION_MODEL || snapshot.prompt_hash !== promptHash) {
      throw Object.assign(new Error('旁白缓存写入后无法复读'), {code: 'cache', failureStage: 'photo-caption'});
    }
    for (const entry of required) {
      const beforeRender = readStat(entry.absPath);
      if (!beforeRender) throw changedError();
      const identity = sourceIdentityRecord(entry.key, beforeRender, PREVIEW_WIDTH);
      const item = cacheHit(snapshot, entry.key, identity);
      if (!item) throw Object.assign(new Error('旁白缓存缺少必需文案'), {code: 'cache', failureStage: 'photo-caption'});
    }
    report();
    return {
      cachePath,
      cache: snapshot,
      requiredKeys: required.map((entry) => entry.key),
      reused,
      generated,
      failed: 0,
      durationMs: Math.max(0, now() - started),
      results,
    };
  } catch (error) {
    local.abort();
    await writer.drain().catch(() => {});
    if (error?.code === 'cancelled' || error?.name === 'AbortError') {
      throw Object.assign(new Error('图片旁白已取消'), {code: 'cancelled', failureStage: 'photo-caption'});
    }
    if (error?.failureStage) throw error;
    throw Object.assign(error instanceof Error ? error : new Error(String(error)), {failureStage: 'photo-caption'});
  } finally {
    signal?.removeEventListener('abort', abortLocal);
  }
};

export const captionsForKeys = (cache, keys) => {
  const texts = new Map();
  for (const key of keys) {
    const item = cache.items[key];
    if (item?.text) texts.set(key, item.text);
  }
  return texts;
};

export const assertUnchangedSources = (projectRoot, sources, cache = null) => {
  for (const source of sources) {
    const absPath = source.absPath ?? source;
    const key = source.key ?? normalizePhotoKey(projectRoot, absPath);
    const stat = readSourceStat(absPath);
    if (!stat || !key) throw changedError();
    const identity = sourceIdentityRecord(key, stat, PREVIEW_WIDTH);
    if (source.identityKey && captionSourceIdentity(key, stat, PREVIEW_WIDTH) !== source.identityKey) {
      throw changedError();
    }
    if (cache && !cacheHit(cache, key, identity)) throw changedError();
  }
};

export {captionsPathFor, identityRecordKey};
