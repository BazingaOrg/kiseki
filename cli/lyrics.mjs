/**
 * tsuzuri lyrics <folder> — 只跑歌词识别(跳过节拍分析),终端预览结果。
 *
 * 每次运行都会重新识别(LRC 即时,Whisper 较慢),方便渲染前先检查歌词对不对。
 */

import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {CliError} from './options.mjs';
import {copyLegacyJson, copyLegacyMetadata, ensureProjectDirs, resolveProjectPaths, scanFolder} from './project.mjs';
import {term} from './term.mjs';
import {runCommand} from './run-command.mjs';
import {acquireCommandLease, createTaskLeaseManager} from './task-lease.mjs';

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// 与 renderer/src/theme.ts 的 SUBTITLE.confidenceThreshold 保持一致:
// 低于这个置信度的段落,渲染时不会显示字幕。
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
          `(置信度 ${segment.confidence.toFixed(2)} 低于渲染阈值 ${confidenceThreshold},视频中不会显示)`,
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

export const runLyrics = (folderArg) => {
  const folder = path.resolve(folderArg);
  const inheritedTask = [
    'TSUZURI_LEASE_TASK_ID',
    'TSUZURI_LEASE_TASK_TOKEN',
    'TSUZURI_LEASE_TASK_ROOT',
  ].some((key) => process.env[key] !== undefined)
    ? acquireCommandLease({kind: 'lyrics', folder})
    : null;
  if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) {
    throw new CliError(`不是文件夹: ${folder}`);
  }

  const task = inheritedTask ?? acquireCommandLease({kind: 'lyrics', folder});
  const originalEnv = Object.fromEntries(
    [...Object.keys(task.env), 'TMPDIR', 'TMP', 'TEMP'].map((key) => [key, process.env[key]]),
  );
  Object.assign(process.env, task.env);
  try {
  const {audio, lyrics} = scanFolder(folder, {requirePhotos: false});
  const project = resolveProjectPaths(folder);
  ensureProjectDirs(project);
  if (copyLegacyMetadata(folder, project.metadataDir)) {
    term.warn('已复制旧版 metadata/ 到 output/metadata/(原目录保留)');
  }
  const copied = copyLegacyJson(folder, project.metadataDir);
  if (copied.length > 0) term.warn(`已复制旧版 JSON 到 output/metadata/: ${copied.join(', ')}(原文件保留)`);

  const analyzer = path.join(REPO, 'analyzer');
  term.start('识别歌词');
  const analyzeArgs = [
    'run', '--project', analyzer, 'tsuzuri-analyze', path.join(folder, audio),
    '--lyrics-only',
    '--lyrics-output', project.lyricsPath,
  ];
  if (lyrics) analyzeArgs.push('--lyrics-file', path.join(folder, lyrics));
  const code = runCommand('识别歌词', 'uv', analyzeArgs);
  if (code !== 0) return code;
  term.success('歌词识别完成');

  const result = JSON.parse(fs.readFileSync(project.lyricsPath, 'utf8'));
  printLyricsPreview(result);
  return 0;
  } finally {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    if (!task.inherited) createTaskLeaseManager().release(task.lease);
  }
};
