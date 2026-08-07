#!/usr/bin/env node
/**
 * tsuzuri CLI — 日常入口:`tsuzuri ./folder`
 *
 * 约定优于配置:文件夹内的图片 + 唯一音频是必需输入,可选唯一 LRC;
 * JSON 写入 metadata/,默认视频写入 output/。
 * -o 可覆盖输出路径,其余选项按素材自动决策。
 */

import {randomUUID} from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {CliError, USAGE, parseArgs} from './options.mjs';
import {
  computeAnalysisHash,
  hasValidAnalysisCache,
  invalidateAnalysisManifest,
  readAnalysisFingerprint,
  writeAnalysisManifest,
} from './analysis-cache.mjs';
import {
  computeInputHash, copyLegacyJson, copyLegacyMetadata, ensureProjectDirs, hasExplicitTrimConfig,
  readFilterConfig, readTrimPreference, resolveProjectPaths, scanFolder, scanFolderLoose,
} from './project.mjs';
import {runDoctor} from './doctor.mjs';
import {offerFetch, runFetch} from './fetch.mjs';
import {runLyrics} from './lyrics.mjs';
import {MENU_BACK, isResidentCommand, runMenu, writeBanner, writeFarewell} from './menu.mjs';
import {PromptAbortError, PromptQuitError} from './prompts.mjs';
import {runStill} from './still.mjs';
import {runWeb} from './web.mjs';
import {term} from './term.mjs';
import {maybePersistTrimChoice} from './trim.mjs';
import {runCommand} from './run-command.mjs';
import {validateTimeline} from './timeline-validator.mjs';
import {resolveRenderOutputPath} from './output-naming.mjs';
import {acquireCommandLease, createTaskLeaseManager} from './task-lease.mjs';

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

export const readValidatedTimeline = (timelinePath, readFileSync = fs.readFileSync) =>
  validateTimeline(JSON.parse(readFileSync(timelinePath, 'utf8')));

export const runCommandFromArgv = async (
  argv,
  {trimInteractive, trimPromptRunner, runCommandImpl = runCommand, offerFetchImpl = offerFetch, runLyricsImpl = runLyrics} = {},
) => {
  const parsed = parseArgs(argv);
  if (parsed.command === 'help') {
    console.log(USAGE);
    return 0;
  }
  if (parsed.command === 'doctor') return runDoctor();
  if (parsed.command === 'fetch') return runFetch(parsed.folder);
  if (parsed.command === 'lyrics') {
    const lyricsFolder = path.resolve(parsed.folder);
    const inherited = [
      'TSUZURI_LEASE_TASK_ID',
      'TSUZURI_LEASE_TASK_TOKEN',
      'TSUZURI_LEASE_TASK_ROOT',
    ].some((key) => process.env[key] !== undefined);
    // A lyrics web job owns its own lease and must not turn into an implicit
    // fetch child. Direct interactive use keeps the existing convenience flow.
    if (!parsed.replace && !inherited && fs.existsSync(lyricsFolder) && fs.statSync(lyricsFolder).isDirectory()) {
      await offerFetchImpl(lyricsFolder);
    }
    return runLyricsImpl(parsed.folder, {replace: parsed.replace});
  }
  if (parsed.command === 'still') return runStill(parsed);
  if (parsed.command === 'web') {
    // server 保持监听,进程靠它挂起,不在这里等待——不返回一个永远不 resolve 的 Promise
    await runWeb(parsed.folder);
    return 0;
  }

  const {folder: folderArg, output, exif, sign, dark, portrait, square, draft, trim, filter} = parsed;
  const folder = path.resolve(folderArg);
  if (!fs.existsSync(folder)) throw new CliError(`找不到路径: ${folder}`);
  if (!fs.statSync(folder).isDirectory()) {
    const ext = path.extname(folder).toLowerCase();
    if (['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) {
      throw new CliError(`不是文件夹: ${folder}\n└ 要导出单张静态图?用: tsuzuri still ${folderArg}`);
    }
    if (['.mp3', '.m4a', '.wav', '.flac', '.aac', '.ogg'].includes(ext)) {
      throw new CliError(`不是文件夹: ${folder}\n└ 请把音频和照片放进一个文件夹后传入该文件夹`);
    }
    throw new CliError(`不是文件夹: ${folder}`);
  }

  // Claim before offerFetch: that interactive helper can download audio or
  // persist lyrics, so an inherited web lease must be authenticated first.
  // The loose scan is read-only and lets us compute the exact default output
  // name even when fetch is about to supply a currently missing audio file.
  const preflight = scanFolderLoose(folder);
  const outputPath = resolveRenderOutputPath({
    folder, output, exif, sign, dark, portrait, square, draft, filter,
    filterConfig: readFilterConfig(folder), photoNames: preflight.photos,
  });
  const project = resolveProjectPaths(folder, outputPath);
  // An inherited job must prove it owns the exact final output before any
  // helper can write project state. Direct invocations acquire that same path.
  const task = acquireCommandLease({kind: 'render', folder, outputPaths: [project.outputPath]});
  const originalEnv = Object.fromEntries(
    [...Object.keys(task.env), 'TMPDIR', 'TMP', 'TEMP'].map((key) => [key, process.env[key]]),
  );
  Object.assign(process.env, task.env);
  let succeeded = false;
  try {
  // 交互终端下缺音频/歌词先给下载与在线搜索的机会;备齐或非交互时不打扰
  await offerFetch(folder, {task});
  const {photos, audio, lyrics, videos} = scanFolder(folder);
  if (videos.length > 0) {
    term.warn(`发现视频文件,tsuzuri 目前只处理照片,已忽略: ${videos.join(', ')}`);
  }
  ensureProjectDirs(project);
  if (copyLegacyMetadata(folder, project.metadataDir)) {
    term.warn('已复制旧版 metadata/ 到 output/metadata/(原目录保留)');
  }
  const copied = copyLegacyJson(folder, project.metadataDir);
  if (copied.length > 0) {
    term.warn(`已复制旧版 JSON 到 output/metadata/: ${copied.join(', ')}(原文件保留)`);
  }
  const effectiveTrim = trim ?? (hasExplicitTrimConfig(folder) ? null : readTrimPreference(project.preferencesPath));

  const inputFiles = () => {
    const files = [audio, ...photos];
    if (fs.existsSync(path.join(folder, 'tsuzuri.toml'))) files.push('tsuzuri.toml');
    if (lyrics) files.push(lyrics);
    return files;
  };
  let hash = computeInputHash(folder, inputFiles());

  const analyzer = path.join(REPO, 'analyzer');
  const timelinePath = project.timelinePath;
  const runtimeFingerprint = readAnalysisFingerprint(analyzer);
  const audioHash = computeAnalysisHash(folder, {audio, lyrics, runtimeFingerprint});
  const skipAnalyze = hasValidAnalysisCache({
    analysisPath: project.analysisPath,
    beatsPath: project.beatsPath,
    lyricsPath: project.lyricsPath,
    audioHash,
  });
  if (skipAnalyze) term.detail('音频和歌词未变,跳过音频分析');

  if (!skipAnalyze) {
    // audioHash 为 null 是环境探测瞬时失败:不清 manifest,保留它让环境恢复
    // 后还能命中(素材未变时)。否则一次瞬时故障会把有效缓存永久烧掉。
    if (audioHash === null) {
      term.warn('运行时指纹获取失败,跳过音频分析缓存');
    } else {
      invalidateAnalysisManifest(project.analysisPath);
    }
    term.start('分析音频');
    const analyzeArgs = [
      'run', '--project', analyzer, 'tsuzuri-analyze', path.join(folder, audio),
      '-o', project.beatsPath,
      '--lyrics-output', project.lyricsPath,
    ];
    if (lyrics) analyzeArgs.push('--lyrics-file', path.join(folder, lyrics));
    const code = runCommandImpl('分析音频', 'uv', analyzeArgs);
    if (code !== 0) return code;
    writeAnalysisManifest({
      analysisPath: project.analysisPath,
      beatsPath: project.beatsPath,
      lyricsPath: project.lyricsPath,
      audioHash,
    });
    term.success('音频分析完成');
  }

  // 规划步骤总是运行,即便素材未变:是否需要用最新算法刷新 timeline.json
  // 交给 plan.py 自己判断——它靠内容校验和识别文件是否被手动改过,手改过就
  // 原样保留,没被动过就悄悄升级到最新分配算法(见 plan.py _content_checksum)
  term.start('规划照片时间线');
  const runPlan = (inputHash, trimOverride = effectiveTrim) => {
    const statusPath = path.join(os.tmpdir(), `tsuzuri-plan-${randomUUID()}.json`);
    const args = [
      'run', '--project', analyzer, 'tsuzuri-plan', folder,
      '--beats', project.beatsPath,
      '--lyrics', project.lyricsPath,
      '--input-hash', inputHash,
      '--status-output', statusPath,
      '-o', project.timelinePath,
    ];
    if (trimOverride !== null) args.push('--trim', trimOverride);
    try {
      const code = runCommandImpl('规划照片时间线', 'uv', args);
      let outcome = null;
      if (fs.existsSync(statusPath)) {
        outcome = JSON.parse(fs.readFileSync(statusPath, 'utf8')).outcome ?? null;
      }
      return {code, outcome};
    } finally {
      fs.rmSync(statusPath, {force: true});
    }
  };
  const {code: planCode, outcome: planOutcome} = runPlan(hash);
  if (planCode !== 0) return planCode;
  term.success('照片时间线规划完成');

  let tl = readValidatedTimeline(timelinePath);
  const trimChoice = await maybePersistTrimChoice({
    folder, preferencesPath: project.preferencesPath, timeline: tl, trimOverride: trim, planOutcome,
    ...(trimInteractive === undefined ? {} : {interactive: trimInteractive}),
    ...(trimPromptRunner === undefined ? {} : {promptRunner: trimPromptRunner}),
  });
  if (trimChoice === 'full') {
    const {code: replanCode} = runPlan(hash, 'full');
    if (replanCode !== 0) return replanCode;
    term.detail('已按完整歌曲重新规划');
    term.success('已记住你的选择');
    tl = readValidatedTimeline(timelinePath);
  }
  const n = tl.photos.filter((clip) => (clip.kind === undefined || clip.kind === 'photo') && typeof clip.src === 'string').length;
  term.info('渲染计划');
  term.detail(
    `照片: ${n} 张,平均每张 ${(tl.meta.duration / n).toFixed(1)}s\n` +
      `音频: ${tl.meta.audio.replace(/^\.\//, '')},${Math.round(tl.meta.duration)}s\n` +
      `歌词: ${tl.subtitles.length > 0 ? `${tl.subtitles.length} 行` : '无(纯音乐或未识别)'}`,
  );

  const outPath = project.outputPath;
  const rendererPackage = path.join(REPO, 'renderer', 'node_modules', '@remotion', 'renderer');
  if (!fs.existsSync(rendererPackage)) throw new CliError('渲染器依赖未安装,先执行: cd renderer && npm install');

  term.start(`渲染视频${exif ? ', EXIF' : ''}${sign ? ', 签名' : ''}${dark ? ', 黑底' : ''}${draft ? ', 草稿' : ''}`);
  const renderCode = runCommandImpl('渲染视频', process.execPath, [
    path.join(REPO, 'cli', 'render.mjs'),
    timelinePath,
    outPath,
    folder,
    ...(exif ? ['--exif'] : []),
    ...(sign ? ['--sign'] : []),
    ...(dark ? ['--dark'] : []),
    ...(portrait ? ['--portrait'] : []),
    ...(square ? ['--square'] : []),
    ...(draft ? ['--draft'] : []),
    ...(filter ? ['--filter', filter.id] : []),
    ...(filter?.intensity !== undefined ? ['--filter-intensity', String(filter.intensity)] : []),
  ]);
  if (renderCode !== 0) return renderCode;
  term.success('视频渲染完成');

  term.success(`完成 → ${outPath}`);
  succeeded = true;
  return 0;
  } finally {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    if (!task.inherited && !createTaskLeaseManager().release(task.lease) && succeeded) throw new CliError('任务 lease 释放失败');
  }
};

const reportCliError = (error) => {
  term.error(`tsuzuri: ${error instanceof Error ? error.message : String(error)}`);
  if ((process.env.TSUZURI_DEBUG === '1' || process.env.DEBUG === '1') && error instanceof Error && error.stack) {
    term.detail(error.stack);
  }
};

export const runInteractiveMenu = async (
  {
    menuRunner = runMenu,
    commandRunner = runCommandFromArgv,
    onError = reportCliError,
    output = process.stdout,
  } = {},
) => {
  for (;;) {
    try {
      const argv = await menuRunner();
      if (argv === null) return 0;
      if (argv === MENU_BACK) {
        output.write('\n返回主菜单\n\n');
        writeBanner(output);
        continue;
      }
      const code = await commandRunner(argv);
      if (code !== 0) term.warn(`流程以退出码 ${code} 结束`);
      else if (isResidentCommand(argv)) {
        // 返回并不等于退出进程:server 的 listening handle 挂住事件循环,
        // 进程活到用户 Ctrl+C(收尾在 web.mjs 的 SIGINT handler 里)。
        // 依赖:菜单退出后进程存活靠这个 handle;若 runWeb 改成不 listen 就返回,菜单会直接退出。
        output.write('\n本地工作台已接管这个终端。要回到菜单,先按 Ctrl+C 结束它,再运行 tsuzuri。\n');
        return 0;
      }
    } catch (error) {
      if (error instanceof PromptQuitError) {
        writeFarewell(output);
        return 0;
      }
      if (error instanceof PromptAbortError) throw error;
      onError(error);
    }
    output.write('\n返回主菜单\n\n');
    writeBanner(output);
  }
};

const main = async () => {
  const argv = process.argv.slice(2);
  // 裸跑 + 交互终端 → 常驻数字菜单;管道/脚本里仍走 USAGE 报错,不破坏可脚本性
  if (argv.length === 0 && process.stdin.isTTY && process.stdout.isTTY) {
    writeBanner();
    return runInteractiveMenu();
  }
  return runCommandFromArgv(argv);
};

const isMain = process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
if (isMain) {
  try {
    process.exitCode = await main();
  } catch (error) {
    if (error instanceof PromptAbortError || error instanceof PromptQuitError) {
      process.exitCode = error.exitCode;
    } else {
      reportCliError(error);
      process.exitCode = 1;
    }
  }
}
