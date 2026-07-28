#!/usr/bin/env node

import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {bundleRenderer, loadRemotionRenderer} from './bundle.mjs';
import {commitAtomicOutput, createPartialOutput, removePartialOutput, resolveAtomicTaskId} from './atomic-output.mjs';
import {FIXES} from './dependencies.mjs';
import {extractFormattedExif} from './exif.mjs';
import {createPercentProgress} from './progress.mjs';
import {readFilterConfig, resolveFilterForPhoto} from './project.mjs';
import {term} from './term.mjs';
import {validateTimeline} from './timeline-validator.mjs';

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

export const readTimeline = (timelinePath, readFileSync = fs.readFileSync) =>
  validateTimeline(JSON.parse(readFileSync(timelinePath, 'utf8')));

/** 渲染前诊断只报告最终 composition 和已解析的设置，不能拿请求参数冒充实际值。 */
export const formatRenderDiagnostics = ({draft, composition, renderSettings, speed = null}) => {
  const speedDetail = speed ? `；速度档位 ${speed}` : '';
  return `实际渲染配置：${draft ? '草稿' : '正式'}；${composition.width}×${composition.height}；${composition.fps} fps；${composition.durationInFrames} 帧；concurrency ${renderSettings.concurrency}${speedDetail}`;
};

const TARGET_LUFS = -14;
const TARGET_TP = -1.5;
const ffmpegQuiet = (args) => spawnSync('ffmpeg', ['-hide_banner', '-nostats', ...args], {encoding: 'utf8'});

const normalizeLoudness = (file) => {
  const probe = ffmpegQuiet(['-i', file, '-map', 'a:0', '-af', `loudnorm=I=${TARGET_LUFS}:TP=${TARGET_TP}:LRA=11:print_format=json`, '-f', 'null', '-']);
  const match = probe.stderr?.match(/\{[\s\S]*?\}/);
  if (probe.error?.code === 'ENOENT') {
    term.warn('找不到命令 ffmpeg,已跳过响度检查');
    term.detail(FIXES.ffmpeg);
    term.detail('运行 tsuzuri doctor 可一次检查全部依赖');
    return;
  }
  if (probe.error || probe.status !== 0 || !match) {
    term.warn('响度测量失败,保留原始响度');
    return;
  }
  let measuredInfo;
  try { measuredInfo = JSON.parse(match[0]); } catch {
    term.warn('响度测量结果无法解析,保留原始响度');
    return;
  }
  const measured = parseFloat(measuredInfo.input_i);
  if (Math.abs(measured - TARGET_LUFS) <= 1.0 && parseFloat(measuredInfo.input_tp) <= -1.0) {
    term.success('响度已符合目标,无需调整');
    term.detail(`${measured.toFixed(1)} LUFS,目标 ${TARGET_LUFS} LUFS`);
    return;
  }
  const tmp = `${file}.loudnorm.mp4`;
  const af = `loudnorm=I=${TARGET_LUFS}:TP=${TARGET_TP}:LRA=11:linear=true:measured_I=${measuredInfo.input_i}:measured_TP=${measuredInfo.input_tp}:measured_LRA=${measuredInfo.input_lra}:measured_thresh=${measuredInfo.input_thresh}:offset=${measuredInfo.target_offset}`;
  const enc = ffmpegQuiet(['-y', '-i', file, '-c:v', 'copy', '-af', af, '-c:a', 'aac', '-b:a', '256k', tmp]);
  if (enc.error || enc.status !== 0 || !fs.existsSync(tmp)) {
    fs.rmSync(tmp, {force: true});
    term.warn('响度归一失败,保留原始响度');
    return;
  }
  try {
    fs.renameSync(tmp, file);
  } finally {
    fs.rmSync(tmp, {force: true});
  }
  term.success('响度归一完成');
  term.detail(`${measured.toFixed(1)} → ${TARGET_LUFS} LUFS(真峰值 ≤ ${TARGET_TP}dB)`);
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
  const taskId = resolveAtomicTaskId();
  const partialOutputPath = createPartialOutput(outputPath, taskId);
  const publicDir = path.resolve(publicDirArg);
  // 必须在加载 Remotion 前失败：内部入口也可直接调用，不能只依赖主 CLI。
  const timeline = readTimeline(timelinePath);
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
    fs.mkdirSync(path.dirname(outputPath), {recursive: true});
    const bundled = await bundleRenderer(publicDir, {
      onProgress: (value) => progress.update('Bundling code', value),
    });
    cleanup = bundled.cleanup;
    // 后面的 detail 会另起一行；只收束 bundling 的活动 TTY 行，不把整个
    // progress 生命周期提前 finish，renderMedia 仍复用它进入渲染阶段。
    progress.endLine();

    const composition = await selectComposition({
      serveUrl: bundled.serveUrl,
      id: 'Diary',
      inputProps,
      logLevel: 'error',
    });
    const totalFrames = composition.durationInFrames;
    // 这里已拿到最终 composition；紧邻 renderMedia 输出，CLI 和 Web fd3 日志看见
    // 的都是同一份实际负载，而非原始请求或百分比历史。
    term.detail(formatRenderDiagnostics({
      draft: flags.draft,
      composition,
      renderSettings,
      speed: ['saver', 'balanced', 'full'].includes(process.env.TSUZURI_RENDER_SPEED)
        ? process.env.TSUZURI_RENDER_SPEED
        : null,
    }));

    await renderMedia({
      serveUrl: bundled.serveUrl,
      composition,
      inputProps,
      codec: 'h264',
      ...renderSettings,
      audioCodec: 'aac',
      pixelFormat: 'yuv420p',
      outputLocation: partialOutputPath,
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
    if (!flags.draft) {
      term.start('检查成片响度');
      normalizeLoudness(partialOutputPath);
    }
    else term.detail('草稿模式: 跳过响度归一');
    commitAtomicOutput(outputPath, partialOutputPath, {taskId});
  } finally {
    removePartialOutput(partialOutputPath);
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
