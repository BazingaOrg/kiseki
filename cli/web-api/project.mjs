/**
 * GET /api/project?path=<abs 素材夹路径> —— 汇总一个素材夹的清单:照片/音频/
 * 歌词(复用 project.mjs 的 scanFolderLoose,宽松扫描不因缺件报错)、逐张滤镜
 * 配置(readFilterConfig)、以及 output/ 下已导出的视频与 still 照片列表。
 * 不做 EXIF 批量提取(耗时,留给前端按需请求单张 /api/photo-exif,MVP 先不做)。
 */
import fs from 'node:fs';
import path from 'node:path';

import {readFilterConfig, scanFolderLoose} from '../project.mjs';
import {parseLrc} from '../lrc.mjs';
import {resolveSafePath} from './sandbox.mjs';

const VIDEO_EXTS = new Set(['.mp4', '.mov', '.avi', '.mkv', '.webm', '.m4v']);
const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp']);

const listOutputFiles = (outputDir, exts) => {
  if (!fs.existsSync(outputDir)) return [];
  try {
    return fs.readdirSync(outputDir, {withFileTypes: true})
      .filter((entry) => entry.isFile() && exts.has(path.extname(entry.name).toLowerCase()))
      .map((entry) => path.join(outputDir, entry.name))
      .sort();
  } catch {
    return [];
  }
};

/**
 * @param {string} root 允许访问的根目录
 * @param {string} requestedPath 素材夹绝对路径
 * @returns {{status: number, body: object}}
 */
export const getProject = (root, requestedPath) => {
  const safePath = resolveSafePath(root, requestedPath);
  if (!safePath) return {status: 403, body: {error: '路径越界或无效'}};
  let stat;
  try {
    stat = fs.statSync(safePath);
  } catch {
    return {status: 404, body: {error: '路径不存在'}};
  }
  if (!stat.isDirectory()) return {status: 400, body: {error: '不是文件夹'}};

  const {photos, audios, lyrics, videos: unsupportedVideos} = scanFolderLoose(safePath);

  let lyricsEntries = null;
  if (lyrics.length > 0) {
    try {
      lyricsEntries = parseLrc(fs.readFileSync(path.join(safePath, lyrics[0]), 'utf8'));
    } catch {
      lyricsEntries = null;
    }
  }

  let filterConfig = null;
  try {
    filterConfig = readFilterConfig(safePath);
  } catch {
    // tsuzuri.json 非法时不阻断画廊浏览,只是不带滤镜配置回去
    filterConfig = null;
  }

  const outputDir = path.join(safePath, 'output');
  const stills = listOutputFiles(path.join(outputDir, 'stills'), IMAGE_EXTS);
  const exportedVideos = listOutputFiles(outputDir, VIDEO_EXTS);

  return {
    status: 200,
    body: {
      path: safePath,
      photos: photos.map((name) => path.join(safePath, name)),
      audio: audios[0] ? path.join(safePath, audios[0]) : null,
      lyricsFile: lyrics[0] ? path.join(safePath, lyrics[0]) : null,
      lyrics: lyricsEntries,
      unsupportedVideos,
      filterConfig,
      output: {
        stills,
        videos: exportedVideos,
      },
    },
  };
};
