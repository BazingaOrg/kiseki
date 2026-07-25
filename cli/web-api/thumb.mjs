/**
 * GET /api/thumb?path=<abs 照片路径>&w=<宽> —— 缩略图。
 *
 * 为什么需要:照片墙和素材条上的小图原本直接引用原图,一张 44px 的缩略图会拉走
 * 一张 3.4MB 的相机原图,十几张就是几十 MB,页面上是一片迟迟不出来的白框。
 *
 * 为什么用 ffmpeg 而不是 sharp:ffmpeg 已经是 tsuzuri 的硬依赖(doctor 会检查、
 * 渲染成片必用),拿它缩图等于零新增依赖;sharp 要引入一个原生模块,为一个缩略图
 * 功能不值当。代价是每张要 spawn 一次进程(~50ms),所以结果落盘缓存,只付一次。
 *
 * 缓存写在系统临时目录,不写进用户的素材夹 —— 用户没要求我们往他的文件夹里放东西。
 */
import {spawn} from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {resolveSafePath} from './sandbox.mjs';

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
// 目录名带上 uid:Linux 上 /tmp 是共享的,固定名会让别的本地用户读到用户照片的
// 缩略图,或抢先把这个名字建成指向自己目录的软链接
const CACHE_DIR = path.join(os.tmpdir(), `tsuzuri-thumbs-${process.getuid?.() ?? 'user'}`);
const DEFAULT_WIDTH = 400;
const MAX_WIDTH = 1024;

/** 宽度收敛到少数几档,避免每个像素宽度都生成一份缓存。 */
export const normalizeWidth = (raw) => {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_WIDTH;
  return [128, 256, 400, 640, MAX_WIDTH].find((step) => value <= step) ?? MAX_WIDTH;
};

/** 缓存键带上 mtime 与大小:原图被替换后自动失效,不必手动清缓存。 */
export const cacheKey = (filePath, stat, width) =>
  crypto
    .createHash('sha1')
    .update(`${filePath}\0${stat.mtimeMs}\0${stat.size}\0${width}`)
    .digest('hex');

const runFfmpeg = (source, destination, width) =>
  new Promise((resolve) => {
    const child = spawn('ffmpeg', [
      '-y', '-v', 'error',
      // 显式带 file: 协议前缀。路径永远以 / 开头,当前拿不到 concat:/http: 之类的
      // 协议混淆,但那是靠"路径形状"侥幸成立;写死协议才是真的挡住
      '-i', `file:${source}`,
      // 比原图更宽时不放大,只缩不放
      '-vf', `scale='min(${width},iw)':-1`,
      '-frames:v', '1',
      '-q:v', '4',
      destination,
    ], {stdio: 'ignore'});
    child.on('error', () => resolve(false));
    child.on('close', (code) => resolve(code === 0 && fs.existsSync(destination)));
  });

/**
 * @param {string} root 允许访问的根目录
 * @param {string} requestedPath 照片绝对路径
 * @param {string|null} rawWidth 查询参数 w
 * @returns {Promise<{status: number, body?: string, headers?: object, streamPath?: string}>}
 */
export const resolveThumb = async (root, requestedPath, rawWidth) => {
  const safePath = resolveSafePath(root, requestedPath);
  if (!safePath) return {status: 403, body: '路径越界或无效'};
  let stat;
  try {
    stat = fs.statSync(safePath);
  } catch {
    return {status: 404, body: '路径不存在'};
  }
  if (!stat.isFile()) return {status: 400, body: '不是文件'};
  if (!IMAGE_EXTS.has(path.extname(safePath).toLowerCase())) {
    return {status: 400, body: '不是支持的图片格式'};
  }

  const width = normalizeWidth(rawWidth);
  const cached = path.join(CACHE_DIR, `${cacheKey(safePath, stat, width)}.jpg`);

  const serve = (filePath, contentType) => ({
    status: 200,
    streamPath: filePath,
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(fs.statSync(filePath).size),
      // 缓存键已含 mtime,内容变了 URL 也会变,可以放心长缓存
      'Cache-Control': 'private, max-age=86400',
    },
  });

  if (fs.existsSync(cached)) return serve(cached, 'image/jpeg');

  try {
    // 0700:缓存里是用户照片的缩略图,不该让同机的其他用户读到
    fs.mkdirSync(CACHE_DIR, {recursive: true, mode: 0o700});
  } catch {
    return serve(safePath, 'image/jpeg');
  }

  // 先写临时文件再 rename:并发请求同一张图时不会读到写了一半的文件
  const pending = `${cached}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp.jpg`;
  const ok = await runFfmpeg(safePath, pending, width);
  if (!ok) {
    fs.rmSync(pending, {force: true});
    // ffmpeg 缺失或解码失败时退回原图 —— 慢,但页面不会开天窗
    return serve(safePath, 'image/jpeg');
  }
  try {
    fs.renameSync(pending, cached);
  } catch {
    fs.rmSync(pending, {force: true});
    return serve(safePath, 'image/jpeg');
  }
  return serve(cached, 'image/jpeg');
};
