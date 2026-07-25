/**
 * GET /api/exif?path=<abs 照片路径> —— 单张照片的 EXIF 展签,复用 exif.mjs 的
 * extractFormattedExif(与渲染成片上那块 EXIF 面板是同一份格式化逻辑,
 * 不会出现"网页上看到的参数和成片里印的不一样")。
 *
 * 按需单张请求而不是在 /api/project 里批量提取:批量解析是实打实的异步 I/O,
 * 一个几十张照片的素材夹会让选择文件夹这一步明显变慢,而 EXIF 只在点开大图时才看。
 */
import fs from 'node:fs';
import path from 'node:path';

import {extractFormattedExif, isDisplayableExif} from '../exif.mjs';
import {resolveSafePath} from './sandbox.mjs';

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp']);

/**
 * @param {string} root 允许访问的根目录
 * @param {string} requestedPath 照片绝对路径
 * @returns {Promise<{status: number, body: object}>}
 */
export const getExif = async (root, requestedPath) => {
  const safePath = resolveSafePath(root, requestedPath);
  if (!safePath) return {status: 403, body: {error: '路径越界或无效'}};
  let stat;
  try {
    stat = fs.statSync(safePath);
  } catch {
    return {status: 404, body: {error: '路径不存在'}};
  }
  // 只对图片跑解析:exifr 不该被指向任意文件
  if (!stat.isFile()) return {status: 400, body: {error: '不是文件'}};
  if (!IMAGE_EXTS.has(path.extname(safePath).toLowerCase())) {
    return {status: 400, body: {error: '不是支持的图片格式'}};
  }

  const exif = await extractFormattedExif(safePath);
  return {
    status: 200,
    body: {
      path: safePath,
      // 照片没有 EXIF 是正常情况(截图、导出图),不是错误——回 200 + null,
      // 前端据此不渲染 EXIF 面板即可
      exif: exif ?? null,
      displayable: isDisplayableExif(exif),
    },
  };
};
