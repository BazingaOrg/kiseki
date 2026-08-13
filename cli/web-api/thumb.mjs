/** GET /api/thumb?path=<abs 照片路径>&w=<宽> —— 缩略图及条件缓存. */
import {spawn} from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import {resolveSafePath} from './sandbox.mjs';
import {sourceRuntimeLayout} from '../runtime-layout.mjs';

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const defaultCacheDir = (runtime) => runtime.thumbCacheRoot;
const DEFAULT_WIDTH = 400;
const MAX_WIDTH = 1024;

export const normalizeWidth = (raw) => {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_WIDTH;
  return [128, 256, 400, 640, MAX_WIDTH].find((step) => value <= step) ?? MAX_WIDTH;
};

const statPart = (stat, nsName, msName) => {
  if (stat[nsName] !== undefined) return String(stat[nsName]);
  // 旧 Node/平台没有 *Ns 时仍将毫秒值明确序列化,不能依赖对象字符串化.
  return String(stat[msName] ?? '');
};

/** 源身份同时作为缓存键和强 ETag 的输入,不能只看 mtime/大小. */
export const sourceIdentity = (filePath, stat, width) => [
  filePath,
  String(stat.dev ?? ''),
  String(stat.ino ?? ''),
  String(stat.size ?? ''),
  statPart(stat, 'mtimeNs', 'mtimeMs'),
  statPart(stat, 'ctimeNs', 'ctimeMs'),
  String(width),
].join('\0');

export const cacheKey = (filePath, stat, width) =>
  crypto.createHash('sha1').update(sourceIdentity(filePath, stat, width)).digest('hex');

export const etagFor = (filePath, stat, width) => `"thumb-${cacheKey(filePath, stat, width)}"`;

/** If-None-Match 使用弱比较;缩略图的当前内容身份由 ETag 完整代表. */
export const matchesIfNoneMatch = (raw, etag) => {
  if (!raw) return false;
  return raw.split(',').some((part) => {
    const candidate = part.trim();
    return candidate === '*' || candidate.replace(/^W\//i, '') === etag;
  });
};

export const MAX_CACHE_ENTRIES = 2000;
const CACHE_ENTRY_RE = /^[a-f0-9]{40}\.jpg$/;

export const pruneCache = (dir = defaultCacheDir(sourceRuntimeLayout), limit = MAX_CACHE_ENTRIES) => {
  let entries;
  try {
    // 只处理本服务以 SHA-1 cache key 命名的产物,绝不顺手删目录里的其他文件.
    entries = fs.readdirSync(dir).filter((name) => CACHE_ENTRY_RE.test(name));
  } catch {
    return 0;
  }
  if (entries.length <= limit) return 0;
  const withTime = [];
  for (const name of entries) {
    try { withTime.push({name, atime: fs.statSync(path.join(dir, name)).atimeMs}); } catch {}
  }
  withTime.sort((a, b) => a.atime - b.atime);
  const removeCount = withTime.length - Math.floor(limit * 0.8);
  let removed = 0;
  for (const {name} of withTime.slice(0, removeCount)) {
    try { fs.rmSync(path.join(dir, name), {force: true}); removed += 1; } catch {}
  }
  return removed;
};

/**
 * 每生成一张缩略图就全目录 readdir + 逐条 statSync 做 LRU 是 O(n²):把
 * "够不够修剪"的判定换成进程内计数,只有计数超限才真正扫一次盘.冷启动时
 * 用一次只读名字的 readdir 校准真实数量,避免上一会话留下的缓存漏修剪.
 * 计数漂移(如外部删文件)最多导致一次多余修剪或一次超限修剪,不影响正确性.
 */
export const createPruner = () => {
  let generatedCount = 0;
  let sessionChecked = false;
  return (dir, limit = MAX_CACHE_ENTRIES) => {
    generatedCount += 1;
    if (!sessionChecked) {
      sessionChecked = true;
      try {
        generatedCount = fs.readdirSync(dir).filter((name) => CACHE_ENTRY_RE.test(name)).length;
      } catch {
        // 目录尚不存在,计数保持 0
      }
    }
    if (generatedCount <= limit) return 0;
    generatedCount = 0;
    return pruneCache(dir, limit);
  };
};

const defaultPruner = createPruner();

export const THUMB_CONCURRENCY = 4;
export const THUMB_TIMEOUT_MS = 30_000;

let ffmpegActive = 0;
const ffmpegWaiters = [];

/**
 * 并发上限内的调度:首屏/快速滚动时大量缓存未命中,不能瞬间拉起几十个
 * ffmpeg.超出的请求排队,前面的结束一个放行一个.
 */
const withFfmpegSlot = (job) => {
  if (ffmpegActive >= THUMB_CONCURRENCY) {
    return new Promise((resolve) => ffmpegWaiters.push(resolve)).then(() => withFfmpegSlot(job));
  }
  ffmpegActive += 1;
  return job().finally(() => {
    ffmpegActive -= 1;
    const next = ffmpegWaiters.shift();
    if (next) next();
  });
};

const ffmpegArgs = (source, destination, width) => [
  '-y', '-v', 'error', '-i', `file:${source}`,
  '-vf', `scale='min(${width},iw)':-1`, '-frames:v', '1', '-q:v', '4', destination,
];

/**
 * @param {{spawn?: Function, timeoutMs?: number}} [options] 测试注入用;超时
 * 兜底 kill 掉卡死的 ffmpeg 返回 false,调用方回源图,不让请求无限挂着.
 */
export const runFfmpeg = (source, destination, width, {spawn: spawnImpl = spawn, timeoutMs = THUMB_TIMEOUT_MS, runtime = sourceRuntimeLayout} = {}) =>
  withFfmpegSlot(() => new Promise((resolve) => {
    const child = spawnImpl(runtime.ffmpeg, ffmpegArgs(source, destination, width), {stdio: 'ignore'});
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve(false);
    }, timeoutMs);
    const done = (ok) => {
      clearTimeout(timer);
      resolve(ok);
    };
    child.on('error', () => done(false));
    child.on('close', (code) => done(code === 0 && fs.existsSync(destination)));
  }));

const readSourceStat = (statSync, filePath) => {
  try { return statSync(filePath, {bigint: true}); } catch {
    try { return statSync(filePath); } catch { return null; }
  }
};

const headersFor = (etag, contentType, size) => ({
  'Content-Type': contentType,
  'Content-Length': String(size),
  ETag: etag,
  'Cache-Control': 'private, no-cache',
});

/**
 * @param {string} root
 * @param {string} requestedPath
 * @param {string|null} rawWidth
 * @param {string|undefined} ifNoneMatch
 * @param {{cacheDir?: string, statSync?: Function, existsSync?: Function, mkdirSync?: Function, rmSync?: Function, renameSync?: Function, generator?: Function, prune?: Function}} [deps]
 */
export const resolveThumb = async (root, requestedPath, rawWidth, ifNoneMatch, deps = {}) => {
  const safePath = resolveSafePath(root, requestedPath);
  if (!safePath) return {status: 403, body: '路径越界或无效'};
  const statSync = deps.statSync ?? fs.statSync;
  const existsSync = deps.existsSync ?? fs.existsSync;
  const mkdirSync = deps.mkdirSync ?? fs.mkdirSync;
  const rmSync = deps.rmSync ?? fs.rmSync;
  const renameSync = deps.renameSync ?? fs.renameSync;
  const runtime = deps.runtime ?? sourceRuntimeLayout;
  const cacheDir = deps.cacheDir ?? defaultCacheDir(runtime);
  const generate = deps.generator ?? ((...args) => runFfmpeg(...args, {runtime}));
  const sourceStat = readSourceStat(statSync, safePath);
  if (!sourceStat) return {status: 404, body: '路径不存在'};
  if (!sourceStat.isFile()) return {status: 400, body: '不是文件'};
  if (!IMAGE_EXTS.has(path.extname(safePath).toLowerCase())) return {status: 400, body: '不是支持的图片格式'};

  const width = normalizeWidth(rawWidth);
  const etag = etagFor(safePath, sourceStat, width);
  if (matchesIfNoneMatch(ifNoneMatch, etag)) {
    return {status: 304, headers: {ETag: etag, 'Cache-Control': 'private, no-cache'}};
  }
  const key = cacheKey(safePath, sourceStat, width);
  const cached = path.join(cacheDir, `${key}.jpg`);
  const serve = (filePath, type) => ({
    status: 200,
    streamPath: filePath,
    headers: headersFor(etag, type, statSync(filePath).size),
  });
  if (existsSync(cached)) return serve(cached, 'image/jpeg');

  try { mkdirSync(cacheDir, {recursive: true, mode: 0o700}); } catch { return serve(safePath, 'image/jpeg'); }

  // 文件在 ffmpeg 期间被替换时,绝不能把新旧内容用旧身份塞进缓存.只重试一次.
  {
    const pending = `${cached}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp.jpg`;
    const ok = await generate(safePath, pending, width);
    const after = readSourceStat(statSync, safePath);
    if (!after || sourceIdentity(safePath, after, width) !== sourceIdentity(safePath, sourceStat, width)) {
      try { rmSync(pending, {force: true}); } catch {}
      if (!deps._thumbRetry) {
        // 从新的身份重新开始,ETag/cache key 都必须一起更新.
        return resolveThumb(root, requestedPath, rawWidth, ifNoneMatch, {...deps, cacheDir, _thumbRetry: true});
      }
      return {status: 409, body: '生成缩略图时源文件持续变化'};
    }
    if (!ok) {
      try { rmSync(pending, {force: true}); } catch {}
      return serve(safePath, 'image/jpeg');
    }
    try { renameSync(pending, cached); } catch {
      try { rmSync(pending, {force: true}); } catch {}
      return serve(safePath, 'image/jpeg');
    }
    (deps.prune ?? defaultPruner)(cacheDir);
    return serve(cached, 'image/jpeg');
  }
};
