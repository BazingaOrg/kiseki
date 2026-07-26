#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {bundleRenderer, loadRemotionRenderer} from './bundle.mjs';
import {extractFormattedExif} from './exif.mjs';
import {createPercentProgress} from './progress.mjs';
import {readFilterConfig, resolveFilterForPhoto} from './project.mjs';

export const detectParallelism = (osModule = os) =>
  typeof osModule.availableParallelism === 'function'
    ? osModule.availableParallelism()
    : osModule.cpus().length;

export const resolveRenderSettings = (
  {draft = false, envConcurrency = process.env.TSUZURI_CONCURRENCY, parallelism = detectParallelism()} = {},
) => {
  // 默认用一半核心,不是"核数减一"。后者在 10 核机器上会拉起 9 个 chromium 把
  // 机器占满,风扇狂转、其它事都别想干了 —— 这是本地工具,渲染时用户多半还在用
  // 这台机器。想要满速的人可以用 TSUZURI_CONCURRENCY 自己拉上去。
  let concurrency = Math.max(1, Math.round(parallelism / 2));
  if (envConcurrency !== undefined && envConcurrency !== '') {
    if (/^\d+$/.test(envConcurrency) && Number(envConcurrency) > 0) {
      concurrency = Number(envConcurrency);
      if (concurrency > parallelism) {
        throw new Error(`TSUZURI_CONCURRENCY 不能超过可用 CPU 数 ${parallelism}`);
      }
    } else if (/^(?:100|[1-9]?\d)%$/.test(envConcurrency) && envConcurrency !== '0%') {
      concurrency = Math.max(1, Math.floor(parallelism * Number.parseInt(envConcurrency, 10) / 100));
    } else {
      throw new Error('TSUZURI_CONCURRENCY 必须是正整数或 1%-100%');
    }
  }
  return {
    concurrency,
    scale: draft ? 2 / 3 : 1,
    crf: draft ? 23 : 16,
    jpegQuality: draft ? 80 : 90,
  };
};

/**
 * 渲染时覆盖 inputProps(timeline.json 本身绝不改写):
 * dark → 黑底;sign → 落款;exif → 按 src 去重逐张提取展签,信息不足置 null。
 * @param {object} timeline
 * @param {{exif?: boolean, sign?: boolean, dark?: boolean, portrait?: boolean, square?: boolean, filter?: {id: string, intensity?: number} | null}} flags
 * @param {{resolvePhotoPath: (src: string) => string, extractExif?: typeof extractFormattedExif, onExifShortage?: (count: number) => void, filterConfig?: object | null}} deps
 */
export const applyRenderVariants = async (
  timeline,
  {exif = false, sign = false, dark = false, portrait = false, square = false, filter = null} = {},
  {resolvePhotoPath, extractExif = extractFormattedExif, onExifShortage, filterConfig = null} = {},
) => {
  if (portrait && square) throw new Error('--portrait 与 --square 不能同时使用');
  if (portrait) timeline.meta = {...timeline.meta, width: 1080, height: 1920};
  if (square) timeline.meta = {...timeline.meta, width: 1080, height: 1080};
  if (dark) {
    timeline.meta = {...timeline.meta, background: '#000000'};
  }
  if (sign) {
    timeline.meta = {...timeline.meta, sign: true};
  }
  if (filter) {
    timeline.meta = {...timeline.meta, filter};
  }
  // 逐张滤镜:CLI --filter > tsuzuri.json 的 perPhoto > 全局配置 > 无;写入 clip.filter
  if (filterConfig) {
    timeline.photos = (timeline.photos ?? []).map((photo) => {
      if ((photo.kind !== undefined && photo.kind !== 'photo') || typeof photo.src !== 'string') return photo;
      const resolved = resolveFilterForPhoto({
        config: filterConfig,
        cliFilter: filter,
        photoName: path.basename(photo.src),
      });
      return resolved ? {...photo, filter: resolved} : photo;
    });
  }
  if (exif) {
    const exifBySrc = new Map();
    for (const photo of (timeline.photos ?? []).filter((clip) => (clip.kind === undefined || clip.kind === 'photo') && typeof clip.src === 'string')) {
      if (exifBySrc.has(photo.src)) continue;
      exifBySrc.set(photo.src, await extractExif(resolvePhotoPath(photo.src)));
    }
    timeline.photos = (timeline.photos ?? []).map((photo) => {
      if ((photo.kind !== undefined && photo.kind !== 'photo') || typeof photo.src !== 'string') return photo;
      const formatted = exifBySrc.get(photo.src) ?? null;
      return {...photo, exif: formatted};
    });
    const shortage = [...exifBySrc.values()].filter((formatted) => !formatted).length;
    if (shortage > 0) onExifShortage?.(shortage);
  }
  return timeline;
};

const main = async () => {
  const [timelineArg, outputArg, publicDirArg, ...flagArgs] = process.argv.slice(2);
  if (!timelineArg || !outputArg || !publicDirArg) {
    throw new Error(
      '用法: render.mjs <timeline.json> <output.mp4> <public-dir> [--exif] [--sign] [--dark] [--portrait|--square] [--draft] [--filter <id>] [--filter-intensity <0-1>]\n' +
        '此为内部入口,日常请用 tsuzuri <folder>',
    );
  }
  const filterIndex = flagArgs.indexOf('--filter');
  const filterIntensityIndex = flagArgs.indexOf('--filter-intensity');
  const flags = {
    exif: flagArgs.includes('--exif'),
    sign: flagArgs.includes('--sign'),
    dark: flagArgs.includes('--dark'),
    portrait: flagArgs.includes('--portrait'),
    square: flagArgs.includes('--square'),
    draft: flagArgs.includes('--draft'),
    filter: filterIndex >= 0
      ? {
          id: flagArgs[filterIndex + 1],
          ...(filterIntensityIndex >= 0 ? {intensity: Number(flagArgs[filterIntensityIndex + 1])} : {}),
        }
      : null,
  };

  const timelinePath = path.resolve(timelineArg);
  const outputPath = path.resolve(outputArg);
  const publicDir = path.resolve(publicDirArg);
  const timeline = JSON.parse(fs.readFileSync(timelinePath, 'utf8'));
  const {renderMedia, selectComposition} = loadRemotionRenderer();
  const progress = createPercentProgress();
  const renderSettings = resolveRenderSettings({draft: flags.draft});
  let cleanup = () => {};

  const filterConfig = readFilterConfig(publicDir);
  const inputProps = await applyRenderVariants(timeline, flags, {
    resolvePhotoPath: (src) => path.join(publicDir, src),
    onExifShortage: (count) => progress.println(`└ ${count} 张照片 EXIF 信息不足,视频中不显示展签`),
    filterConfig,
  });

  try {
    const bundled = await bundleRenderer(publicDir, {
      onProgress: (value) => progress.update('Bundling code', value),
    });
    cleanup = bundled.cleanup;

    const composition = await selectComposition({
      serveUrl: bundled.serveUrl,
      id: 'Diary',
      inputProps,
      logLevel: 'error',
    });
    const totalFrames = composition.durationInFrames;

    await renderMedia({
      serveUrl: bundled.serveUrl,
      composition,
      inputProps,
      codec: 'h264',
      ...renderSettings,
      audioCodec: 'aac',
      pixelFormat: 'yuv420p',
      outputLocation: outputPath,
      overwrite: true,
      logLevel: 'error',
      // 接管浏览器控制台输出:不再与进行中的进度行挤在同一行
      onBrowserLog: ({type, text, stackTrace}) => {
        if (type !== 'error' && type !== 'warning') return;
        const at = stackTrace?.[0]?.url
          ? ` (${stackTrace[0].url}:${stackTrace[0].lineNumber ?? '?'})`
          : '';
        progress.println(`[browser ${type}] ${text}${at}`);
      },
      onProgress: ({renderedFrames, encodedFrames}) => {
        if (renderedFrames < totalFrames) {
          progress.update('Rendering frames', renderedFrames / totalFrames);
        } else {
          progress.update('Encoding video', encodedFrames / totalFrames);
        }
      },
    });
    progress.update('Encoding video', 1);
  } finally {
    progress.finish();
    cleanup();
  }
};

const isMain =
  process.argv[1] &&
  fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
if (isMain) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    if ((process.env.TSUZURI_DEBUG === '1' || process.env.DEBUG === '1') && error instanceof Error && error.stack) console.error(error.stack);
    process.exitCode = 1;
  }
}
