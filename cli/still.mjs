/**
 * tsuzuri still — 纯 Node 管道:扫描照片 → 可选 EXIF → renderStill PNG。
 * 不碰 analyzer / uv。
 */

import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {extractFormattedExif} from './exif.mjs';
import {CliError} from './options.mjs';
import {bundleRenderer, loadRemotionRenderer, RENDERER} from './bundle.mjs';
import {createPercentProgress} from './progress.mjs';
import {term} from './term.mjs';

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const PRESENTATION_SUFFIXES = ['', '-exif', '-sign', '-dark', '-exif-sign', '-exif-dark', '-sign-dark', '-exif-sign-dark'];
const CANVAS_SUFFIXES = ['', '-portrait', '-square'];
const ALL_VARIANT_SUFFIXES = PRESENTATION_SUFFIXES.flatMap((presentation) =>
  CANVAS_SUFFIXES.map((canvas) => `${presentation}${canvas}`),
);

const DEFAULT_CANVAS = {
  width: 1920,
  height: 1080,
  background: '#FFFFFF',
  photo_scale: 0.8,
  signature: '',
};

/**
 * 极简 flat toml 读取(tsuzuri.toml 仅一层 key = value)。镜像约束见
 * docs/config.md;analyzer/plan.py 使用 tomllib,这里不要扩展嵌套 TOML 语法。
 * 只取 still 需要的画布字段;解析失败时回退默认并警告。
 */
export const loadStillCanvasConfig = (folder) => {
  const cfg = {...DEFAULT_CANVAS};
  const tomlPath = path.join(folder, 'tsuzuri.toml');
  if (!fs.existsSync(tomlPath)) return cfg;
  try {
    const text = fs.readFileSync(tomlPath, 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const m = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/);
      if (!m) continue;
      const key = m[1];
      let raw = m[2].trim();
      if (raw.startsWith('#') || raw.includes(' #')) {
        raw = raw.replace(/\s+#.*$/, '').trim();
      }
      if (key === 'width' || key === 'height') {
        const n = Number(raw);
        if (Number.isFinite(n) && n > 0) cfg[key] = Math.round(n);
      } else if (key === 'photo_scale') {
        const n = Number(raw);
        if (Number.isFinite(n) && n > 0 && n <= 1) cfg.photo_scale = n;
      } else if (key === 'background') {
        const s = raw.replace(/^["']|["']$/g, '');
        if (s) cfg.background = s;
      } else if (key === 'signature') {
        cfg.signature = raw.replace(/^["']|["']$/g, '');
      }
    }
  } catch {
    term.warn('tsuzuri.toml 无法解析,still 使用默认画布');
  }
  return cfg;
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
          `图片文件名会导致 still 变体输出冲突: ${path.basename(previous)} / ${path.basename(job.absPath)} → ${outputName}\n` +
          '└ 请重命名其中一张图片后重试',
        );
      }
      producers.set(key, job.absPath);
    }
  }
};

export const resolveJobs = (target, output, {exif = false, sign = false, dark = false, portrait = false, square = false} = {}) => {
  const variantSuffix = `${exif ? '-exif' : ''}${sign ? '-sign' : ''}${dark ? '-dark' : ''}${portrait ? '-portrait' : ''}${square ? '-square' : ''}`;
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
      throw new CliError(`文件夹里没有图片: ${resolved}`);
    }
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
      term.warn(`同名图片输出冲突,已保留源扩展名消歧: ${group.map((job) => path.basename(job.outPath)).join(', ')}`);
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

  const {publicDir, canvasFolder, jobs} = resolveJobs(opts.target, opts.output, opts);
  const canvas = loadStillCanvasConfig(canvasFolder);
  if (opts.dark) canvas.background = '#000000';
  if (opts.portrait) Object.assign(canvas, {width: 1080, height: 1920});
  if (opts.square) Object.assign(canvas, {width: 1080, height: 1080});
  const {renderStill, selectComposition} = loadRemotionRenderer();
  const progress = createPercentProgress();
  let cleanup = () => {};
  let skipped = 0;
  let skippedExif = 0;
  let rendered = 0;

  term.start(`导出 still(${jobs.length} 张, scale=${opts.scale}${opts.exif ? ', EXIF' : ''}${opts.sign ? ', 签名' : ''}${opts.dark ? ', 黑底' : ''})`);

  try {
    const bundled = await bundleRenderer(publicDir, {
      onProgress: (value) => progress.update('Bundling code', value),
    });
    cleanup = bundled.cleanup;

    const compositionInputProps = {
      src: jobs[0].src,
      background: canvas.background,
      photoScale: canvas.photo_scale,
      width: canvas.width,
      height: canvas.height,
      exif: null,
      sign: opts.sign,
      ...(opts.sign && canvas.signature ? {signatureSrc: canvas.signature} : {}),
      filter: opts.filter ?? null,
    };
    const composition = await selectComposition({serveUrl: bundled.serveUrl, id: 'Still', inputProps: compositionInputProps, logLevel: 'error'});
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
          const label = jobs.length === 1 ? 'Rendering still' : `Rendering still ${i + 1}/${jobs.length}`;
          progress.update(label, (i + 1) / jobs.length);
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
        filter: opts.filter ?? null,
      };

      fs.mkdirSync(path.dirname(job.outPath), {recursive: true});

      await renderStill({
        serveUrl: bundled.serveUrl,
        // selectComposition 只做一次以复用相同画布元数据;其 resolved props
        // 必须按 job 更新,否则首次选择时的 exif:null 会覆盖动态 inputProps。
        composition: {...composition, props: inputProps},
        inputProps,
        output: job.outPath,
        imageFormat: 'png',
        scale: opts.scale,
        overwrite: true,
        logLevel: 'error',
        onBrowserLog: ({type, text}) => {
          if (type === 'error' || type === 'warning') {
            progress.println(`[browser ${type}] ${text}`);
          }
        },
      });

      const label =
        jobs.length === 1
          ? 'Rendering still'
          : `Rendering still ${i + 1}/${jobs.length}`;
      progress.update(label, (i + 1) / jobs.length);
      progress.println(`→ ${job.outPath}`);
      rendered++;
    }
    if (skipped > 0) progress.println(`└ 跳过 ${skipped} 张已存在(--skip-existing)`);
    if (skippedExif > 0) progress.println(`└ 跳过 ${skippedExif} 张 EXIF 信息不足`);
    progress.update('Rendering still', 1);
  } finally {
    progress.finish();
    cleanup();
  }

  if (rendered === 0) {
    const reasons = [
      ...(skipped > 0 ? [`${skipped} 张已存在`] : []),
      ...(skippedExif > 0 ? [`${skippedExif} 张 EXIF 信息不足`] : []),
    ];
    term.success(`still 完成 → 未导出图片${reasons.length > 0 ? `(${reasons.join(',')})` : ''}`);
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
