/**
 * tsuzuri still — 纯 Node 管道:扫描照片 → 可选 EXIF → renderStill PNG.
 * 不碰 analyzer / uv.
 */

import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {extractFormattedExif} from './exif.mjs';
import {loadProjectConfig} from './config.mjs';
import {CliError} from './options.mjs';
import {bundleRenderer, loadRemotionRenderer, RENDERER} from './bundle.mjs';
import {commitAtomicOutput, createPartialOutput, removePartialOutput, resolveAtomicTaskId} from './atomic-output.mjs';
import {createPercentProgress} from './progress.mjs';
import {readFilterConfig, resolveFilterForPhoto} from './project.mjs';
import {term} from './term.mjs';
import {resolveOutputVariantSuffix} from './output-naming.mjs';
import {acquireCommandLease} from './task-lease.mjs';

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const PRESENTATION_SUFFIXES = ['', '-exif', '-sign', '-dark', '-exif-sign', '-exif-dark', '-sign-dark', '-exif-sign-dark'];
const CANVAS_SUFFIXES = ['', '-portrait', '-square'];
const ALL_VARIANT_SUFFIXES = PRESENTATION_SUFFIXES.flatMap((presentation) =>
  CANVAS_SUFFIXES.map((canvas) => `${presentation}${canvas}`),
);

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

const assertNoCrossVariantCollisions = (jobs, variantSuffix) => {
  const producers = new Map();
  for (const job of jobs) {
    const currentStem = path.basename(job.outPath, '.png');
    const outputStem = variantSuffix
      ? currentStem.slice(0, -variantSuffix.length)
      : currentStem;
    for (const suffix of ALL_VARIANT_SUFFIXES) {
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

export const resolveJobs = (target, output, {exif = false, sign = false, dark = false, portrait = false, square = false, filter = null} = {}) => {
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
      exif, sign, dark, portrait, square, filter,
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
      exif, sign, dark, portrait, square, filter,
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
    assertNoCrossVariantCollisions(jobs, variantSuffix);
    return {
      publicDir: resolved,
      canvasFolder: resolved,
      jobs,
    };
  }

  throw new CliError(`不是文件或文件夹: ${resolved}`);
};

/**
 * @param {{target: string, output: string | null, exif: boolean, sign: boolean, dark: boolean, skipExisting: boolean, scale: number, filter?: {id: string, intensity?: number} | null}} opts
 */
export const runStill = async (opts) => {
  const rendererPackage = path.join(RENDERER, 'node_modules', '@remotion', 'renderer');
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

  try {
    const resolved = resolveJobs(opts.target, opts.output, opts);
    jobs = resolved.jobs;
    task = acquireCommandLease({kind: 'still', folder: resolved.canvasFolder, outputPaths: jobs.map((job) => job.outPath)});
    originalEnv = Object.fromEntries(
      [...Object.keys(task.env), 'TMPDIR', 'TMP', 'TEMP'].map((key) => [key, process.env[key]]),
    );
    Object.assign(process.env, task.env);

    const canvas = loadStillCanvasConfig(resolved.canvasFolder);
    const filterConfig = readFilterConfig(resolved.canvasFolder);
    const resolveJobFilter = (job) =>
      resolveFilterForPhoto({config: filterConfig, cliFilter: opts.filter ?? null, photoName: job.src});
    if (opts.dark) canvas.background = '#000000';
    if (opts.portrait) Object.assign(canvas, {width: 1080, height: 1920});
    if (opts.square) Object.assign(canvas, {width: 1080, height: 1080});
    const {openBrowser, renderStill, selectComposition} = loadRemotionRenderer();
    progress = createPercentProgress();
    const taskId = resolveAtomicTaskId();
    const stillProgressLabel = (index) =>
      jobs.length === 1 ? 'Rendering still' : `Rendering still ${index + 1}/${jobs.length}`;

    term.start(`导出 still(${jobs.length} 张, scale=${opts.scale}${opts.exif ? ', EXIF' : ''}${opts.sign ? ', 签名' : ''}${opts.dark ? ', 暗色' : ''})`);
    const bundled = await bundleRenderer(resolved.publicDir, {
      onProgress: (value) => progress.update('Bundling code', value),
    });
    cleanup = bundled.cleanup;
    // 诊断须独占一行;不 finish,后面的批量进度仍沿用稳定的 Rendering still stage.
    progress.endLine();

    // 复用同一个 Chromium 渲染全部照片:每张冷启动一次浏览器是批量导出
    // 的最大开销.selectComposition 与 renderStill 都吃同一个 puppeteerInstance.
    const browser = await openBrowser('chrome', {logLevel: 'error'});
    cleanup = () => {
      Promise.resolve(browser.close({silent: true})).catch(() => {});
      bundled.cleanup();
    };

    const compositionInputProps = {
      src: jobs[0].src,
      background: canvas.background,
      photoScale: canvas.photo_scale,
      width: canvas.width,
      height: canvas.height,
      exif: null,
      sign: opts.sign,
      ...(opts.sign && canvas.signature ? {signatureSrc: canvas.signature} : {}),
      filter: resolveJobFilter(jobs[0]),
    };
    const composition = await selectComposition({serveUrl: bundled.serveUrl, id: 'Still', inputProps: compositionInputProps, logLevel: 'error', puppeteerInstance: browser});
    term.detail(formatStillDiagnostics({canvas, scale: opts.scale, jobs}));
    for (let i = 0; i < jobs.length; i++) {
      const job = jobs[i];
      if (opts.skipExisting && fs.existsSync(job.outPath)) {
        skipped++;
        continue;
      }
      let exifProps;
      if (opts.exif) {
        exifProps = await extractFormattedExif(job.absPath);
        if (!exifProps) {
          skippedExif++;
          progress.println(`└ ${path.basename(job.absPath)}: EXIF 信息不足,已跳过导出`);
          progress.update(stillProgressLabel(i), (i + 1) / jobs.length, 'Rendering still');
          continue;
        }
      }

      const inputProps = {
        src: job.src,
        background: canvas.background,
        photoScale: canvas.photo_scale,
        width: canvas.width,
        height: canvas.height,
        sign: opts.sign,
        ...(opts.sign && canvas.signature ? {signatureSrc: canvas.signature} : {}),
        exif: exifProps ?? null,
        filter: resolveJobFilter(job),
      };

      fs.mkdirSync(path.dirname(job.outPath), {recursive: true});

      activePartial = createPartialOutput(job.outPath, taskId);
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

      commitAtomicOutput(job.outPath, activePartial, {taskId});
      activePartial = null;

      progress.update(stillProgressLabel(i), (i + 1) / jobs.length, 'Rendering still');
      progress.println(`→ ${job.outPath}`);
      rendered++;
    }
    if (skipped > 0) progress.println(`└ 跳过 ${skipped} 张已存在(--skip-existing)`);
    if (skippedExif > 0) progress.println(`└ 跳过 ${skippedExif} 张 EXIF 信息不足`);
    progress.update(stillProgressLabel(jobs.length - 1), 1, 'Rendering still');
  } catch (error) {
    didThrow = true;
    primaryError = error;
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

  if (rendered === 0) {
    const reasons = [
      ...(skipped > 0 ? [`${skipped} 张已存在`] : []),
      ...(skippedExif > 0 ? [`${skippedExif} 张 EXIF 信息不足`] : []),
    ];
    term.success(`still 完成 → 未导出静态图${reasons.length > 0 ? `(${reasons.join(',')})` : ''}`);
  } else {
    const destination = jobs.length === 1 ? jobs[0].outPath : path.dirname(jobs[0].outPath);
    const skippedTotal = skipped + skippedExif;
    term.success(`still 完成 → ${destination}${skippedTotal > 0 ? ` (导出 ${rendered} 张,跳过 ${skippedTotal} 张)` : ''}`);
  }
  return 0;
};

const isMain =
  process.argv[1] &&
  fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
if (isMain) {
  // 便于单独调试:node cli/still.mjs <target> ...
  const {parseArgs} = await import('./options.mjs');
  try {
    const parsed = parseArgs(['still', ...process.argv.slice(2)]);
    process.exitCode = await runStill(parsed);
  } catch (error) {
    term.error(`tsuzuri still: ${error instanceof Error ? error.message : String(error)}`);
    if ((process.env.TSUZURI_DEBUG === '1' || process.env.DEBUG === '1') && error instanceof Error && error.stack) term.detail(error.stack);
    process.exitCode = 1;
  }
}
