/**
 * kiseki lyrics <folder> — 只跑歌词识别(跳过节拍分析),终端预览结果.
 *
 * 每次运行都会重新识别(LRC 即时,Whisper 较慢),方便渲染前先检查歌词对不对.
 */

import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';

import {CliError} from './options.mjs';
import {copyLegacyJson, copyLegacyMetadata, ensureProjectDirs, resolveProjectPaths, scanFolder, scanFolderLoose} from './project.mjs';
import {term} from './term.mjs';
import {runCommandSpec} from './run-command.mjs';
import {acquireCommandLease, createTaskLeaseManager} from './task-lease.mjs';
import {installAtomicOutputs, outputArtifactPaths} from './atomic-output.mjs';
import {hasUsableRecognizedLyricsPayload, isRecognizedLyricsManageable} from './recognized-lyrics.mjs';
import {sourceRuntimeLayout} from './runtime-layout.mjs';
import {createNodeCommandResolver} from './command-resolver.mjs';

// 与 renderer/src/theme.ts 的 SUBTITLE.confidenceThreshold 保持一致:
// 低于这个置信度的段落,渲染时不会显示字幕.
export const RENDER_CONFIDENCE_THRESHOLD = 0.6;

const formatTimestamp = (totalSeconds) => {
  const clamped = Math.max(0, totalSeconds);
  const minutes = Math.floor(clamped / 60);
  const seconds = clamped - minutes * 60;
  return `${String(minutes).padStart(2, '0')}:${seconds.toFixed(1).padStart(4, '0')}`;
};

/**
 * Pure formatting of a lyrics.json payload into printable lines. Kept side-effect-free
 * (no term.* calls) so it's testable without spawning python.
 */
export const formatLyricsPreview = (lyrics, {confidenceThreshold = RENDER_CONFIDENCE_THRESHOLD} = {}) => {
  const lines = [
    {
      kind: 'info',
      text: `来源: ${lyrics.backend} · 语言: ${lyrics.language} · 每次运行都会重新识别(LRC 即时,Whisper 较慢)`,
    },
  ];

  if (lyrics.segments.length === 0) {
    lines.push({kind: 'info', text: '未识别到人声(纯音乐?),渲染时将跳过字幕'});
    return lines;
  }

  for (const segment of lyrics.segments) {
    const range = `[${formatTimestamp(segment.start)} → ${formatTimestamp(segment.end)}]`;
    if (segment.confidence < confidenceThreshold) {
      lines.push({
        kind: 'warn',
        text:
          `${range} ${segment.text} ` +
          `(置信度 ${segment.confidence.toFixed(2)} 低于渲染阈值 ${confidenceThreshold},成片里不会显示)`,
      });
    } else {
      lines.push({kind: 'line', text: `${range} ${segment.text}`});
    }
  }
  return lines;
};

const printLyricsPreview = (lyrics, options) => {
  for (const line of formatLyricsPreview(lyrics, options)) {
    if (line.kind === 'warn') term.warn(line.text);
    else term.info(line.text);
  }
};

const regularOrMissing = (file) => {
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new CliError('识别结果路径不安全或已变化');
    return true;
  } catch (error) { if (error?.code === 'ENOENT') return false; throw error; }
};

const assertMissing = (file) => {
  try { fs.lstatSync(file); throw new CliError('任务原子输出残留,任务状态不安全'); }
  catch (error) { if (error?.code === 'ENOENT') return; throw error; }
};

const recognizedIdentity = (lyricsPath) => {
  const stat = fs.lstatSync(lyricsPath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new CliError('识别结果不存在或已变化');
  return {
    path: fs.realpathSync(lyricsPath),
    dev: stat.dev,
    ino: stat.ino,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    digest: crypto.createHash('sha256').update(fs.readFileSync(lyricsPath)).digest('hex'),
  };
};

const fileIdentityOrAbsent = (file) => {
  try { return {present: true, ...recognizedIdentity(file)}; }
  catch (error) { if (error?.code === 'ENOENT') return {present: false}; throw error; }
};

const assertRecognizedIdentity = ({lyricsPath, lrcFiles, identity}) => {
  if (!isRecognizedLyricsManageable({lyricsPath, lrcFiles})) throw new CliError('识别结果不存在或已变化');
  const current = recognizedIdentity(lyricsPath);
  if (Object.keys(identity).some((key) => current[key] !== identity[key])) throw new CliError('识别结果已变化,未替换');
};

const assertReplacementInputs = ({project, identity}) => {
  assertRecognizedIdentity({lyricsPath: project.lyricsPath, lrcFiles: scanFolderLoose(path.dirname(path.dirname(project.metadataDir))).lyrics, identity: identity.lyrics});
  const timeline = fileIdentityOrAbsent(project.timelinePath);
  if (JSON.stringify(timeline) !== JSON.stringify(identity.timeline)) throw new CliError('时间线已变化,未替换');
};

const ensureCanonicalMetadata = (folder, metadataDir) => {
  const root = fs.realpathSync(folder);
  const relativeMetadata = path.relative(path.resolve(folder), path.resolve(metadataDir));
  if (!relativeMetadata || relativeMetadata === '..' || relativeMetadata.startsWith(`..${path.sep}`) || path.isAbsolute(relativeMetadata)) {
    throw new CliError('metadata 路径不安全或已变化');
  }
  const canonicalMetadata = path.resolve(root, relativeMetadata);
  for (const directory of [path.dirname(canonicalMetadata), canonicalMetadata]) {
    const relativeDirectory = path.relative(root, directory);
    if (!relativeDirectory || relativeDirectory === '..' || relativeDirectory.startsWith(`..${path.sep}`) || path.isAbsolute(relativeDirectory)) {
      throw new CliError('metadata 路径不安全或已变化');
    }
    try { fs.mkdirSync(directory); } catch (error) { if (error?.code !== 'EEXIST') throw error; }
    const stat = fs.lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink() || fs.realpathSync(directory) !== directory) {
      throw new CliError('metadata 路径不安全或已变化');
    }
  }
};

const replaceRecognizedLyrics = ({project, stagedPath, task, identity, beforeMarkCommitting}) => {
  const taskId = task.lease.id;
  for (const file of [project.lyricsPath, project.timelinePath]) regularOrMissing(file);
  for (const file of [outputArtifactPaths(project.lyricsPath, taskId).partialPath, outputArtifactPaths(project.lyricsPath, taskId).backupPath, outputArtifactPaths(project.timelinePath, taskId).partialPath, outputArtifactPaths(project.timelinePath, taskId).backupPath]) assertMissing(file);
  if (!regularOrMissing(stagedPath)) throw new CliError('识别输出不存在或已变化');
  const staged = JSON.parse(fs.readFileSync(stagedPath, 'utf8'));
  if (!hasUsableRecognizedLyricsPayload(staged)) throw new CliError('识别输出没有可用歌词,已保留原结果');
  task.manager.extendOutputClaims(task.lease, [project.lyricsPath, project.timelinePath]);
  let finalizeError = null;
  const transaction = {
    prepare: (entries) => task.manager.prepareOutputTransaction(task.lease, entries),
    markCommitting: () => {
      beforeMarkCommitting?.();
      assertReplacementInputs({project, identity});
      task.manager.setOutputTransactionPhase(task.lease, 'committing');
    },
    markCommitted: () => task.manager.setOutputTransactionPhase(task.lease, 'committed'),
    rollback: () => task.manager.rollbackOutputTransaction(task.lease),
    // Once committed, lease recovery is authoritative. Do not report a cleanup
    // retry as a failed recognition or attempt rollback of durable new output.
    finalize: () => { try { task.manager.finalizeOutputTransaction(task.lease); } catch (error) { finalizeError = error; } },
  };
  installAtomicOutputs({taskId, writes: [{finalPath: project.lyricsPath, source: stagedPath}], deletes: [project.timelinePath], transaction});
  return {finalizeError};
};

export const runLyrics = async (
  folderArg,
  {replace = false, runCommandImpl, runCommandSpecImpl = runCommandSpec, beforeMarkCommitting, leaseManager = createTaskLeaseManager(), runtime = sourceRuntimeLayout, commandResolver = createNodeCommandResolver({runtime})} = {},
) => {
  const folder = path.resolve(folderArg);
  const inheritedTask = [
    'KISEKI_LEASE_TASK_ID',
    'KISEKI_LEASE_TASK_TOKEN',
    'KISEKI_LEASE_TASK_ROOT',
  ].some((key) => process.env[key] !== undefined)
    ? acquireCommandLease({kind: 'lyrics', folder, manager: leaseManager})
    : null;
  if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) {
    throw new CliError(`不是文件夹: ${folder}`);
  }

  const task = inheritedTask ?? acquireCommandLease({kind: 'lyrics', folder, manager: leaseManager});
  const originalEnv = Object.fromEntries(
    [...Object.keys(task.env), 'TMPDIR', 'TMP', 'TEMP'].map((key) => [key, process.env[key]]),
  );
  Object.assign(process.env, task.env);
  let outcome = null;
  let stagedPath = null;
  let primaryError = null;
  try {
  const {audio, lyrics} = scanFolder(folder, {requirePhotos: false});
  const project = resolveProjectPaths(folder);
  if (replace) ensureCanonicalMetadata(folder, project.metadataDir);
  else ensureProjectDirs(project);
  if (copyLegacyMetadata(folder, project.metadataDir)) {
    term.warn('已复制旧版 metadata/ 到 output/metadata/(原目录保留)');
  }
  const copied = copyLegacyJson(folder, project.metadataDir);
  if (copied.length > 0) term.warn(`已复制旧版 JSON 到 output/metadata/: ${copied.join(', ')}(原文件保留)`);
  const lrcFiles = scanFolderLoose(folder).lyrics;
  if (replace && lrcFiles.length !== 0) throw new CliError('检测到 LRC 歌词,不能替换本地识别结果');
  if (replace && !isRecognizedLyricsManageable({lyricsPath: project.lyricsPath, lrcFiles})) {
    throw new CliError('没有可替换的本地识别歌词');
  }
  if (isRecognizedLyricsManageable({lyricsPath: project.lyricsPath, lrcFiles}) && !replace) {
    throw new CliError('已有可用的本地识别歌词;如要替换,请使用 kiseki lyrics <folder> --replace');
  }

  stagedPath = replace ? path.join(task.lease.taskRoot, 'tmp', 'recognized-lyrics.json') : project.lyricsPath;
  if (replace) {
    if (regularOrMissing(stagedPath)) throw new CliError('识别 staging 文件已存在,任务状态不安全');
    for (const file of [project.lyricsPath, project.timelinePath]) regularOrMissing(file);
    for (const file of [outputArtifactPaths(project.lyricsPath, task.lease.id).partialPath, outputArtifactPaths(project.lyricsPath, task.lease.id).backupPath, outputArtifactPaths(project.timelinePath, task.lease.id).partialPath, outputArtifactPaths(project.timelinePath, task.lease.id).backupPath]) assertMissing(file);
  }
  const oldRecognizedIdentity = replace ? {lyrics: recognizedIdentity(project.lyricsPath), timeline: fileIdentityOrAbsent(project.timelinePath)} : null;
  const lyricsTask = term.task('识别歌词');
  const analyzeArgs = [
    path.join(folder, audio),
    '--lyrics-only',
    '--lyrics-output', stagedPath,
  ];
  if (lyrics) analyzeArgs.push('--lyrics-file', path.join(folder, lyrics));
  const analyzeCommand = commandResolver.analyzer('kiseki-analyze', analyzeArgs);
  let code;
  try {
    code = await Promise.resolve(
      runCommandImpl
        ? runCommandImpl('识别歌词', analyzeCommand.executable, analyzeCommand.args, {env: analyzeCommand.env})
        : runCommandSpecImpl('识别歌词', analyzeCommand),
    );
  } catch (error) {
    lyricsTask.fail();
    throw error;
  }
  if (code !== 0) {
    lyricsTask.fail();
    if (replace) fs.rmSync(stagedPath, {force: true});
    outcome = code;
    return code;
  }
  try {
    if (replace) {
      assertRecognizedIdentity({lyricsPath: project.lyricsPath, lrcFiles: scanFolderLoose(folder).lyrics, identity: oldRecognizedIdentity.lyrics});
      if (JSON.stringify(fileIdentityOrAbsent(project.timelinePath)) !== JSON.stringify(oldRecognizedIdentity.timeline)) throw new CliError('时间线已变化,未替换');
      replaceRecognizedLyrics({project, stagedPath, task, identity: oldRecognizedIdentity, beforeMarkCommitting});
    }
    lyricsTask.succeed();
  } catch (error) {
    lyricsTask.fail();
    throw error;
  }

  const result = JSON.parse(fs.readFileSync(project.lyricsPath, 'utf8'));
  printLyricsPreview(result);
  outcome = 0;
  return 0;
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    const secondary = [];
    try { if (replace && stagedPath) fs.rmSync(stagedPath, {force: true}); } catch (error) { secondary.push(error); }
    for (const [key, value] of Object.entries(originalEnv)) {
      try { if (value === undefined) delete process.env[key]; else process.env[key] = value; } catch (error) { secondary.push(error); }
    }
    if (!task.inherited) {
      try {
        if (!leaseManager.release(task.lease) && outcome === 0) secondary.unshift(new Error('任务 lease 释放失败'));
      } catch (error) { secondary.unshift(error); }
    }
    if (primaryError && secondary.length) primaryError.cause = new AggregateError(secondary, '清理阶段附带失败');
    if (!primaryError && outcome === 0 && secondary.length === 1) throw secondary[0];
    if (!primaryError && outcome === 0 && secondary.length > 1) throw new AggregateError(secondary, '任务完成后的清理失败');
  }
};
