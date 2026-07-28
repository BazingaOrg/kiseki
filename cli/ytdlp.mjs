import {spawn, spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';

import {createPercentProgress} from './progress.mjs';
import {scanFolderLoose} from './project.mjs';

export const SEARCH_LIMIT = 5;
export const YTDLP_PROGRESS_LABEL = '下载音频';

const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;
const YTDLP_PROGRESS_RE = /^\[download\]\s+(\d{1,3}(?:\.\d+)?)%/;

/** 把 yt-dlp 的下载行抹平成 CLI/Web 共用的 progress 契约。 */
export const parseYtDlpProgress = (line) => {
  const clean = String(line ?? '').replace(ANSI_RE, '').trim();
  const match = YTDLP_PROGRESS_RE.exec(clean);
  if (!match) return null;
  const value = Number.parseFloat(match[1]);
  if (!Number.isFinite(value) || value < 0 || value > 100) return null;
  return {kind: 'progress', label: YTDLP_PROGRESS_LABEL, percent: Math.round(value)};
};

/** 解析 yt-dlp --print "%(id)s\t%(title)s\t%(duration_string)s\t%(channel,uploader)s" 的一行。 */
export const parseSearchLine = (line) => {
  const parts = String(line ?? '').split('\t');
  if (parts.length < 2 || !parts[0].trim()) return null;
  const clean = (s) => (s && s !== 'NA' ? s.trim() : null);
  return {
    id: parts[0].trim(),
    title: clean(parts[1]) ?? '(无标题)',
    duration: clean(parts[2]) ?? '?:??',
    uploader: clean(parts[3]) ?? '未知频道',
  };
};

export const checkYtDlp = (spawn = spawnSync) => {
  const r = spawn('yt-dlp', ['--version'], {encoding: 'utf8'});
  if (r.error || r.status !== 0) return {ok: false};
  return {ok: true, version: (r.stdout ?? '').trim()};
};

export const searchYtDlp = (query) => {
  const r = spawnSync(
    'yt-dlp',
    [
      `ytsearch${SEARCH_LIMIT}:${query}`,
      '--flat-playlist',
      '--print', '%(id)s\t%(title)s\t%(duration_string)s\t%(channel,uploader)s',
    ],
    {encoding: 'utf8'},
  );
  if (r.error || r.status !== 0) {
    return {ok: false, stderr: (r.stderr ?? '').trim()};
  }
  const candidates = (r.stdout ?? '').split('\n').map(parseSearchLine).filter(Boolean);
  return {ok: true, candidates};
};

/**
 * 始终下载到素材目录外的临时目录。这既能强制同 URL 重新下载,
 * 也保证 yt-dlp/转码失败时不会碰到已有素材。
 */
export const downloadWithYtDlp = (
  url,
  {spawn = spawnSync, tempParent = os.tmpdir(), stdio = 'inherit'} = {},
) => {
  const tempDir = fs.mkdtempSync(path.join(tempParent, 'tsuzuri-fetch-'));
  const r = spawn(
    'yt-dlp',
    ['-x', '--audio-format', 'm4a', '--no-playlist', '-o', path.join(tempDir, '%(title)s.%(ext)s'), url],
    {stdio},
  );
  if (r.error || r.status !== 0) {
    fs.rmSync(tempDir, {recursive: true, force: true});
    return {ok: false};
  }
  const audios = scanFolderLoose(tempDir).audios;
  if (audios.length !== 1) {
    fs.rmSync(tempDir, {recursive: true, force: true});
    return {ok: false};
  }
  return {
    ok: true,
    tempDir,
    audio: audios[0],
    source: path.join(tempDir, audios[0]),
  };
};

/**
 * fetch 交互流程专用的流式下载。yt-dlp 自身的百分比被解析后交给共享进度器，
 * 因而 TTY 与重定向日志分别遵循同一行刷新和稳定节流规则。错误文字保留给调用方
 * 用 term.detail 输出，避免子进程原样刷屏后再重复报一次失败。
 */
export const downloadWithYtDlpProgress = (
  url,
  {
    spawnImpl = spawn,
    tempParent = os.tmpdir(),
    progress = createPercentProgress(),
  } = {},
) => new Promise((resolve) => {
  const tempDir = fs.mkdtempSync(path.join(tempParent, 'tsuzuri-fetch-'));
  let settled = false;
  const stderr = [];
  const finish = (result) => {
    if (settled) return;
    settled = true;
    progress.finish();
    if (!result.ok) fs.rmSync(tempDir, {recursive: true, force: true});
    resolve(result);
  };
  let child;
  try {
    child = spawnImpl(
      'yt-dlp',
      [
        '-x', '--audio-format', 'm4a', '--no-playlist', '--newline', '--no-color',
        '-o', path.join(tempDir, '%(title)s.%(ext)s'), url,
      ],
      {stdio: ['ignore', 'pipe', 'pipe']},
    );
  } catch (error) {
    finish({ok: false, stderr: error instanceof Error ? error.message : String(error)});
    return;
  }

  const stdout = child.stdout
    ? readline.createInterface({input: child.stdout})
    : null;
  stdout?.on('line', (line) => {
    const event = parseYtDlpProgress(line);
    if (event) progress.update(event.label, event.percent / 100, event.label);
  });
  stdout?.on('error', () => {});
  child.stderr?.setEncoding('utf8');
  child.stderr?.on('data', (chunk) => {
    stderr.push(...String(chunk).replace(ANSI_RE, '').split(/\r?\n/).filter(Boolean));
  });
  child.stderr?.on('error', () => {});
  child.on('error', (error) => {
    const text = error instanceof Error ? error.message : String(error);
    finish({ok: false, stderr: [...stderr, text].join('\n')});
  });
  child.on('close', (code) => {
    stdout?.close();
    if (code !== 0) {
      finish({ok: false, stderr: stderr.join('\n')});
      return;
    }
    const audios = scanFolderLoose(tempDir).audios;
    if (audios.length !== 1) {
      finish({ok: false, stderr: '下载结果不是单个音频文件'});
      return;
    }
    finish({
      ok: true,
      tempDir,
      audio: audios[0],
      source: path.join(tempDir, audios[0]),
      warnings: stderr.filter((line) => /^warning:/i.test(line.trim())),
    });
  });
});
