/**
 * GET /media?path=<abs> —— 媒体文件透传(照片/视频/音频),支持 Range 以便
 * 视频/音频拖进度条.这是唯一直接把文件内容吐给浏览器的接口,路径沙箱校验
 * 必须最严格:全部走 resolveSafePath(与 dirs/project 共用同一实现),并且
 * 额外要求目标是一个普通文件(不透传目录/设备文件等).
 */
import fs from 'node:fs';
import path from 'node:path';

import {resolveSafePath} from './sandbox.mjs';

const CONTENT_TYPES = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
};

const contentTypeFor = (filePath) => CONTENT_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';

const parseRange = (rangeHeader, size) => {
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader ?? '');
  if (!match) return null;
  const [, startRaw, endRaw] = match;
  if (!startRaw && !endRaw) return null;
  let start = startRaw ? Number(startRaw) : size - Number(endRaw);
  let end = endRaw && startRaw ? Number(endRaw) : size - 1;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start >= size || start > end) return null;
  // end 超出文件大小时截断到最后一个字节,而不是整个 range 失效退化成 200
  end = Math.min(end, size - 1);
  return {start, end};
};

/**
 * 把结果描述成 {status, headers, stream|body} 交由 web-server.mjs 写回响应,
 * 保持本模块可在不起真实 server 的情况下单测.
 * @param {string} root 允许访问的根目录
 * @param {string} requestedPath 客户端传入的文件路径
 * @param {string|undefined} rangeHeader 请求的 Range 头
 */
export const resolveMedia = (root, requestedPath, rangeHeader) => {
  const safePath = resolveSafePath(root, requestedPath);
  if (!safePath) return {status: 403, headers: {}, body: '路径越界或无效'};
  let stat;
  try {
    stat = fs.statSync(safePath);
  } catch {
    return {status: 404, headers: {}, body: '路径不存在'};
  }
  if (!stat.isFile()) return {status: 403, headers: {}, body: '不是文件'};

  const contentType = contentTypeFor(safePath);
  const range = parseRange(rangeHeader, stat.size);
  if (range) {
    return {
      status: 206,
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(range.end - range.start + 1),
        'Content-Range': `bytes ${range.start}-${range.end}/${stat.size}`,
        'Accept-Ranges': 'bytes',
      },
      streamPath: safePath,
      streamOptions: {start: range.start, end: range.end},
    };
  }
  return {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(stat.size),
      'Accept-Ranges': 'bytes',
    },
    streamPath: safePath,
    streamOptions: {},
  };
};
