/**
 * kiseki still — 纯 Node 管道:扫描照片 → 可选 EXIF → renderStill PNG.
 * 不碰 analyzer / uv.
 */

import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {extractFormattedExif} from './exif.mjs';
import {loadProjectConfig} from './config.mjs';
import {CliError} from './options.mjs';
import {bundleRenderer, loadRemotionRenderer} from './bundle.mjs';
import {sourceRuntimeLayout} from './runtime-layout.mjs';
import {commitAtomicOutput, createPartialOutput, removePartialOutput, resolveAtomicTaskId} from './atomic-output.mjs';
import {createPercentProgress} from './progress.mjs';
import {readFilterConfig, resolveFilterForPhoto} from './project.mjs';
import {formatDuration, paint, term} from './term.mjs';
import {enumerateOutputVariantSuffixes, resolveFilterOutputSuffix, resolveOutputVariantSuffix} from './output-naming.mjs';
import {acquireCommandLease} from './task-lease.mjs';
import {assertUnchangedSources, captionsForKeys, preparePhotoCaptions, requireCaptionApiKey} from './ai/photo-caption-service.mjs';
import {emitCaptionFailure, withProcessAbort} from './ai/caption-runtime.mjs';
import {normalizePhotoKey} from './ai/photo-key.mjs';
import {captionPageFromBrowser, fitStillCaption} from './ai/photo-caption-fit.mjs';
import {loadCaptionCache, captionsPathFor} from './ai/photo-caption-cache.mjs';

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp']);

/** 读取视频/still 共享配置 schema,仅投影 still 所需画布字段. */
export const loadStillCanvasConfig = (folder) => {
  const {values} = loadProjectConfig(folder);
  return {
    width: values.width,
    height: values.height,
    background: values.background,
    photo_scale: values.photo_scale,
    signature: values.signature,
  };
};

/** 静态导出诊断只使用解析后的画布、倍率和确定的输出目标. */
export const formatStillDiagnostics = ({canvas, scale, jobs}) => {
  const destination = jobs.length === 1 ? jobs[0].outPath : path.dirname(jobs[0].outPath);
  return `实际静态导出配置:${canvas.width * scale}×${canvas.height * scale} px;输出倍率 ${scale};${jobs.length} 张;输出 ${destination}`;
};

const listPhotosInFolder = (folder) => {
  const entries = fs.readdirSync(folder).filter((f) => !f.startsWith('.'));
  return entries
    .filter((f) => IMAGE_EXTS.has(path.extname(f).toLowerCase()))
    .sort()
    .map((f) => path.join(folder, f));
};

const assertNoCrossVariantCollisions = (jobs, variantSuffix, extraFilterSuffixes = ['']) => {
  const suffixes = enumerateOutputVariantSuffixes({extraFilterSuffixes});
  const producers = new Map();
  for (const job of jobs) {
    const currentStem = path.basename(job.outPath, '.png');
    const outputStem = variantSuffix && currentStem.endsWith(variantSuffix)
      ? currentStem.slice(0, -variantSuffix.length)
      : currentStem;
    for (const suffix of suffixes) {
      const outputName = `${outputStem}${suffix}.png`;
      const key = outputName.toLowerCase();
      const previous = producers.get(key);
      if (previous && previous !== job.absPath) {
        throw new CliError(
          `照片文件名会导致 still 变体输出冲突: ${path.basename(previous)} / ${path.basename(job.absPath)} → ${outputName}\n` +
          '└ 请重命名其中一张照片后重试',
        );
      }
      producers.set(key, job.absPath);
    }
  }
};

export const resolveJobs = (target, output, {exif = false, sign = false, photoCaption = false, dark = false, portrait = false, square = false, filter = null} = {}) => {
  const resolved = path.resolve(target);
  if (!fs.existsSync(resolved)) {
    throw new CliError(`找不到路径: ${resolved}`);
  }
  const stat = fs.statSync(resolved);

  if (stat.isFile()) {
    const ext = path.extname(resolved).toLowerCase();
    if (!IMAGE_EXTS.has(ext)) {
      throw new CliError(`不是支持的图片格式: ${resolved}(支持 ${[...IMAGE_EXTS].join(' ')})`);
    }
    const publicDir = path.dirname(resolved);
    const variantSuffix = resolveOutputVariantSuffix({
      exif, sign, photoCaption, dark, portrait, square, filter,
      filterConfig: readFilterConfig(publicDir), photoNames: [path.basename(resolved)],
    });
    const base = path.basename(resolved, path.extname(resolved));
    const filename = `${base}${variantSuffix}.png`;
    let outPath;
    if (output) {
      const outResolved = path.resolve(output);
      // 目录意图看原始输入的结尾分隔符(path.resolve 会吞掉它);
      // `/` 两平台通吃,`\` 只在 Windows 是分隔符(POSIX 上是合法文件名字符)
      const dirIntent =
        output.endsWith('/') || (process.platform === 'win32' && output.endsWith('\\'));
      if (dirIntent || (fs.existsSync(outResolved) && fs.statSync(outResolved).isDirectory())) {
        outPath = path.join(outResolved, filename);
      } else if (path.extname(outResolved).toLowerCase() === '.png' || path.extname(outResolved) === '') {
        outPath = path.extname(outResolved) ? outResolved : `${outResolved}.png`;
      } else {
        throw new CliError('still 只导出 PNG,-o 请以 .png 结尾或传目录');
      }
    } else {
      outPath = path.join(publicDir, 'output', 'stills', filename);
    }
    return {
      publicDir,
      canvasFolder: publicDir,
      jobs: [{src: path.basename(resolved), absPath: resolved, outPath}],
    };
  }

  if (stat.isDirectory()) {
    const photos = listPhotosInFolder(resolved);
    if (photos.length === 0) {
      throw new CliError(`文件夹里没有照片: ${resolved}`);
    }
    const variantSuffix = resolveOutputVariantSuffix({
      exif, sign, photoCaption, dark, portrait, square, filter,
      filterConfig: readFilterConfig(resolved), photoNames: photos.map((photo) => path.basename(photo)),
    });
    const outDir = output
      ? path.resolve(output)
      : path.join(resolved, 'output', 'stills');
    const jobs = photos.map((absPath) => {
      const base = path.basename(absPath, path.extname(absPath));
      return {src: path.basename(absPath), absPath, outPath: path.join(outDir, `${base}${variantSuffix}.png`)};
    });
    const groups = new Map();
    for (const job of jobs) {
      const key = job.outPath.toLowerCase();
      groups.set(key, [...(groups.get(key) ?? []), job]);
    }
    for (const group of groups.values()) {
      if (group.length < 2) continue;
      for (const job of group) {
        const sourceExt = path.extname(job.absPath).slice(1).toLowerCase();
        const base = path.basename(job.absPath, path.extname(job.absPath));
        job.outPath = path.join(outDir, `${base}-${sourceExt}${variantSuffix}.png`);
      }
      term.warn(`同名照片输出冲突,已保留源扩展名消歧: ${group.map((job) => path.basename(job.outPath)).join(', ')}`);
    }
    const extraFilter = resolveFilterOutputSuffix({
      filter,
      filterConfig: readFilterConfig(resolved),
      photoNames: photos.map((photo) => path.basename(photo)),
    });
    assertNoCrossVariantCollisions(jobs, variantSuffix, extraFilter ? ['', extraFilter] : ['']);
    return {
      publicDir: resolved,
      canvasFolder: resolved,
      jobs,
    };
  }

  throw new CliError(`不是文件或文件夹: ${resolved}`);
};

export const prepareStillJobs = async (jobs, {
  skipExisting = false,
  exif = false,
  extractExif = extractFormattedExif,
  existsSync = fs.existsSync,
} = {}) => {
  const prepared = [];
  let skipped = 0;
  let skippedExif = 0;
  for (const job of jobs) {
    if (skipExisting && existsSync(job.outPath)) {
      skipped += 1;
      continue;
    }
    let exifProps = null;
    if (exif) {
      exifProps = await extractExif(job.absPath);
      if (!exifProps) {
        skippedExif += 1;
        continue;
      }
    }
    prepared.push({...job, exifProps});
  }
  return {prepared, skipped, skippedExif};
};

/**
 * @param {{target: string, output: string | null, exif: boolean, sign: boolean, photoCaption?: boolean, dark: boolean, skipExisting: boolean, scale: number, filter?: {id: string, intensity?: number} | null}} opts
 */
export const runStill = async (opts, {runtime = sourceRuntimeLayout} = {}) => {
  const rendererPackage = path.join(runtime.rendererRoot, 'node_modules', '@remotion', 'renderer');
  if (!fs.existsSync(rendererPackage)) {
    throw new CliError('渲染器依赖未安装,先执行: cd renderer && npm install');
  }

  let task = null;
  let originalEnv = null;
  let progress = null;
  let cleanup = () => {};
  let skipped = 0;
  let skippedExif = 0;
  let rendered = 0;
  let jobs = null;
  let activePartial = null;
  let primaryError = null;
  let didThrow = false;
  let startedAt = null;
  let exportTask = null;
  let capturedKey = undefined;

  try {
    if (opts.photoCaption) capturedKey = requireCaptionApiKey();
    const resolved = resolveJobs(opts.target, opts.output, opts);
    jobs = resolved.jobs;
    task = acquireCommandLease({kind: 'still', folder: resolved.canvasFolder, outputPaths: jobs.map((job) => job.outPath)});
    startedAt = Date.now();
    originalEnv = Object.fromEntries(
      [...Object.keys(task.env), 'TMPDIR', 'TMP', 'TEMP', 'DEEPSEEK_API_KEY'].map((key) => [key, process.env[key]]),
    );
    Object.assign(process.env, task.env);
    delete process.env.DEEPSEEK_API_KEY;

    const canvas = loadStillCanvasConfig(resolved.canvasFolder);
    const filterConfig = readFilterConfig(resolved.canvasFolder);
    const resolveJobFilter = (job) =>
      resolveFilterForPhoto({config: filterConfig, cliFilter: opts.filter ?? null, photoName: job.src});
    if (opts.dark) canvas.background = '#000000';
    if (opts.portrait) Object.assign(canvas, {width: 1080, height: 1920});
    if (opts.square) Object.assign(canvas, {width: 1080, height: 1080});
    const preflight = await prepareStillJobs(jobs, {skipExisting: opts.skipExisting, exif: opts.exif});
    skipped = preflight.skipped;
    skippedExif = preflight.skippedExif;
    const preparedJobs = preflight.prepared;
    term.detail(`${jobs.length} 张, scale=${opts.scale}${opts.exif ? ', EXIF' : ''}${opts.sign ? ', 签名' : ''}${opts.photoCaption ? ', 图片旁白' : ''}${opts.dark ? ', 暗色' : ''}`);
    if (preparedJobs.length === 0) {
      jobs = preparedJobs;
      if (skipped > 0) term.detail(`跳过 ${skipped} 张已存在(--skip-existing)`);
      if (skippedExif > 0) term.detail(`跳过 ${skippedExif} 张 EXIF 信息不足`);
    } else {
    let captionTexts = new Map();
    if (opts.photoCaption) {
      const captionTask = term.task('准备图片旁白');
      progress = createPercentProgress();
      try {
        captionTask.endLine();
        const prepared = await withProcessAbort((signal) => preparePhotoCaptions({
          projectRoot: resolved.canvasFolder,
          sources: preparedJobs.map((job) => ({
            absPath: job.absPath,
            key: normalizePhotoKey(resolved.canvasFolder, job.absPath),
          })),
          apiKey: capturedKey,
          signal,
          onProgress: ({completed, total, reused, generated}) => {
            progress.update('Photo captions', total === 0 ? 1 : completed / total, 'Photo captions', {completed, total, reused, generated});
            if (completed === total) term.detail(`复用 ${reused} 条，新生成 ${generated} 条`);
          },
        }));
        progress.finish();
        captionTask.succeed();
        captionTexts = captionsForKeys(prepared.cache, prepared.requiredKeys);
      } catch (error) {
        progress.finish();
        captionTask.fail();
        emitCaptionFailure(error);
        throw error;
      }
    }

    const {openBrowser, renderStill, selectComposition} = loadRemotionRenderer(runtime);
    progress = createPercentProgress();
    const taskId = resolveAtomicTaskId();
    const stillProgressLabel = (index) =>
      preparedJobs.length === 1 ? 'Rendering still' : `Rendering still ${index + 1}/${preparedJobs.length}`;

    exportTask = term.task('导出 still');
    exportTask.endLine();
    const bundled = await bundleRenderer(resolved.publicDir, {
      runtime,
      onProgress: (value) => progress.update('Bundling code', value),
    });
    cleanup = bundled.cleanup;
    progress.endLine();

    const browser = await openBrowser('chrome', {logLevel: 'error', browserExecutable: runtime.chromium});
    cleanup = () => {
      Promise.resolve(browser.close({silent: true})).catch(() => {});
      bundled.cleanup();
    };

    const compositionInputProps = {
      src: preparedJobs[0].src,
      background: canvas.background,
      photoScale: canvas.photo_scale,
      width: canvas.width,
      height: canvas.height,
      exif: null,
      sign: opts.sign,
      ...(opts.sign && canvas.signature ? {signatureSrc: canvas.signature} : {}),
      filter: resolveJobFilter(preparedJobs[0]),
    };
    const composition = await selectComposition({serveUrl: bundled.serveUrl, id: 'Still', inputProps: compositionInputProps, logLevel: 'error', puppeteerInstance: browser});
    term.detail(formatStillDiagnostics({canvas, scale: opts.scale, jobs: preparedJobs}));
    const captionPage = opts.photoCaption ? await captionPageFromBrowser(browser, bundled.serveUrl) : null;
    let skippedLayout = 0;
    for (let i = 0; i < preparedJobs.length; i++) {
      const job = preparedJobs[i];
      const key = normalizePhotoKey(resolved.canvasFolder, job.absPath);
      const captionSources = key ? [{absPath: job.absPath, key}] : [];
      if (opts.photoCaption && key) {
        assertUnchangedSources(resolved.canvasFolder, captionSources, loadCaptionCache(captionsPathFor(resolved.canvasFolder)));
      }
      const inputProps = {
        src: job.src,
        background: canvas.background,
        photoScale: canvas.photo_scale,
        width: canvas.width,
        height: canvas.height,
        sign: opts.sign,
        ...(opts.sign && canvas.signature ? {signatureSrc: canvas.signature} : {}),
        exif: job.exifProps ?? null,
        filter: resolveJobFilter(job),
      };
      if (opts.photoCaption && key && captionTexts.get(key)) {
        const cache = loadCaptionCache(captionsPathFor(resolved.canvasFolder));
        const item = cache.items[key];
        const visualScale = Math.min(canvas.width, canvas.height) / 1080;
        inputProps.caption = captionTexts.get(key);
        inputProps.captionLayout = await fitStillCaption({
          text: inputProps.caption,
          canvasWidth: canvas.width,
          canvasHeight: canvas.height,
          photoScale: canvas.photo_scale,
          imageWidth: item?.preview_pixel_width || 640,
          imageHeight: item?.preview_pixel_height || 480,
          visualScale,
          hasExif: Boolean(job.exifProps),
          sign: opts.sign,
          page: captionPage,
        });
        if (!inputProps.captionLayout) skippedLayout += 1;
      }

      fs.mkdirSync(path.dirname(job.outPath), {recursive: true});

      activePartial = createPartialOutput(job.outPath, taskId);
      if (opts.photoCaption && key) {
        assertUnchangedSources(resolved.canvasFolder, captionSources, loadCaptionCache(captionsPathFor(resolved.canvasFolder)));
      }
      await renderStill({
        serveUrl: bundled.serveUrl,
        // selectComposition 只做一次以复用相同画布元数据;其 resolved props
        // 必须按 job 更新,否则首次选择时的 exif:null 会覆盖动态 inputProps.
        composition: {...composition, props: inputProps},
        inputProps,
        output: activePartial,
        imageFormat: 'png',
        scale: opts.scale,
        overwrite: true,
        logLevel: 'error',
        puppeteerInstance: browser,
        onBrowserLog: ({type, text}) => {
          if (type === 'error' || type === 'warning') {
            progress.println(`[browser ${type}] ${text}`);
          }
        },
      });

      if (opts.photoCaption && key) {
        assertUnchangedSources(resolved.canvasFolder, captionSources, loadCaptionCache(captionsPathFor(resolved.canvasFolder)));
      }
      commitAtomicOutput(job.outPath, activePartial, {taskId});
      activePartial = null;

      progress.update(stillProgressLabel(i), (i + 1) / preparedJobs.length, 'Rendering still');
      progress.println(`→ ${job.outPath}`);
      rendered++;
    }
    if (skipped > 0) progress.println(`└ 跳过 ${skipped} 张已存在(--skip-existing)`);
    if (skippedExif > 0) progress.println(`└ 跳过 ${skippedExif} 张 EXIF 信息不足`);
    if (skippedLayout > 0) progress.println(`└ 旁白排版跳过 ${skippedLayout} 张`);
    progress.update(stillProgressLabel(preparedJobs.length - 1), 1, 'Rendering still');
    }
    jobs = preparedJobs;
  } catch (error) {
    didThrow = true;
    primaryError = error;
    exportTask?.fail();
    throw error;
  } finally {
    const cleanupErrors = [];
    const tryCleanup = (label, action) => {
      try {
        action();
      } catch (error) {
        cleanupErrors.push(new Error(`still 清理失败(${label}): ${error instanceof Error ? error.message : String(error)}`, {cause: error}));
      }
    };

    try {
      if (activePartial) tryCleanup('删除 partial 输出', () => removePartialOutput(activePartial));
    } finally {
      try {
        if (progress) tryCleanup('结束进度', () => progress.finish());
      } finally {
        try {
          tryCleanup('清理 renderer bundle', cleanup);
        } finally {
          try {
            if (originalEnv) {
              for (const [key, value] of Object.entries(originalEnv)) {
                tryCleanup(`恢复环境变量 ${key}`, () => {
                  if (value === undefined) delete process.env[key]; else process.env[key] = value;
                });
              }
            }
          } finally {
            if (task && !task.inherited) {
              tryCleanup('释放 lease', () => {
                if (!task.manager.release(task.lease)) throw new Error('lease 未释放');
              });
            }
          }
        }
      }
    }

    if (cleanupErrors.length > 0) {
      if (didThrow) {
        if (primaryError && typeof primaryError === 'object') {
          try { primaryError.cleanupErrors = cleanupErrors; } catch {}
        }
        for (const error of cleanupErrors) {
          try { term.error(error.message); } catch {}
        }
      } else {
        throw new AggregateError(cleanupErrors, 'still 清理失败');
      }
    }
  }

  exportTask?.succeed();
  const elapsed = startedAt == null ? '' : `    ${formatDuration(Date.now() - startedAt)}`;
  if (rendered === 0) {
    const reasons = [
      ...(skipped > 0 ? [`${skipped} 张已存在`] : []),
      ...(skippedExif > 0 ? [`${skippedExif} 张 EXIF 信息不足`] : []),
    ];
    term.success(`still 完成 → 未导出静态图${reasons.length > 0 ? `(${reasons.join(',')})` : ''}${elapsed}`);
  } else {
    const destination = jobs.length === 1 ? jobs[0].outPath : path.dirname(jobs[0].outPath);
    const skippedTotal = skipped + skippedExif;
    term.success(`still 完成 → ${paint('path', destination)}${skippedTotal > 0 ? ` (导出 ${rendered} 张,跳过 ${skippedTotal} 张)` : ''}${elapsed}`);
  }
  return 0;
};

const isMain =
  process.argv[1] &&
  fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
if (isMain) {
  // 便于单独调试:node cli/still.mjs <target> ...
  const {loadLocalEnv} = await import('./load-env.mjs');
  loadLocalEnv();
  const {parseArgs} = await import('./options.mjs');
  try {
    const parsed = parseArgs(['still', ...process.argv.slice(2)]);
    process.exitCode = await runStill(parsed);
  } catch (error) {
    term.error(`kiseki still: ${error instanceof Error ? error.message : String(error)}`);
    if ((process.env.KISEKI_DEBUG === '1' || process.env.DEBUG === '1') && error instanceof Error && error.stack) term.detail(error.stack);
    process.exitCode = 1;
  }
}
