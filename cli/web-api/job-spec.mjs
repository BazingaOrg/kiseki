/**
 * 任务描述:把网页选项校验并组装为命令、参数和进度来源.
 *
 * 这里不管理子进程或任务状态,方便独立测试;JobValidationError 始终直接
 * 从 job-argv.mjs 导入,确保 HTTP 层的 instanceof 判断保持同一类身份.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {buildAudioFilename, installDownloadedAudio, sanitizeFilePart} from '../fetch.mjs';
import {FIXES} from '../dependencies.mjs';
import {readFilterConfig, scanFolderLoose} from '../project.mjs';
import {resolveJobs} from '../still.mjs';
import {resolveRenderOutputPath} from '../output-naming.mjs';
import {JobValidationError, buildJobInvocation} from '../job-argv.mjs';
import {parseYtDlpProgress, YTDLP_PROGRESS_LABEL} from '../ytdlp.mjs';

export {JobValidationError} from '../job-argv.mjs';

const CLI_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const TSUZURI_ENTRY = path.join(CLI_DIR, 'tsuzuri.mjs');
const YTDLP_ID_RE = /^[A-Za-z0-9_-]{5,64}$/;

/** yt-dlp 下载进度事件的标签. */
export {parseYtDlpProgress, YTDLP_PROGRESS_LABEL};

const readOptionalString = (value, field) => {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string') throw new JobValidationError(field, `${field} 必须是字符串`);
  return value;
};

const normalizeFetchAudioMetadata = (options) => {
  const title = sanitizeFilePart(readOptionalString(options?.title, 'title'));
  if (!title) throw new JobValidationError('title', 'title 不能为空');
  const artist = sanitizeFilePart(readOptionalString(options?.artist, 'artist'));
  return {title, artist};
};

const buildFetchAudioSpec = ({folder, options, tempParent}) => {
  const id = options?.id;
  if (typeof id !== 'string' || !YTDLP_ID_RE.test(id)) {
    throw new JobValidationError('id', 'id 必须是 yt-dlp 视频 id(字母、数字、- 和 _)');
  }
  const {title, artist} = normalizeFetchAudioMetadata(options);
  const tempDir = fs.mkdtempSync(path.join(tempParent, 'tsuzuri-fetch-'));
  const finalFilename = buildAudioFilename({title, artist, ext: '.m4a'});
  return {
    command: 'yt-dlp',
    tempDir,
    args: [
      '-x', '--audio-format', 'm4a', '--no-playlist', '--newline', '--no-color',
      '-o', path.join(tempDir, '%(title)s.%(ext)s'),
      `https://www.youtube.com/watch?v=${id}`,
    ],
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
    progressSource: 'ytdlp-stdout',
    outputPaths: [path.join(folder, 'audio', finalFilename)],
    finalize: (code, {stderrTail = [], spawnFailed = false, task = null} = {}) => {
      try {
        if (spawnFailed) {
          return {ok: false, events: [{kind: 'error', text: `起不了 yt-dlp,确认它已安装并在 PATH 里.${FIXES['yt-dlp']}`}]};
        }
        if (code !== 0) {
          const detail = stderrTail.length > 0 ? `\n${stderrTail.join('\n')}` : '';
          return {ok: false, events: [{kind: 'error', text: `下载失败(网络、地区限制或 yt-dlp 版本过旧)${detail}`}]};
        }
        const audios = scanFolderLoose(tempDir).audios;
        if (audios.length !== 1) {
          return {ok: false, events: [{kind: 'error', text: '下载结果不是单个音频文件'}]};
        }
        const filename = buildAudioFilename({title, artist, ext: path.extname(audios[0])});
        const installed = installDownloadedAudio({
          source: path.join(tempDir, audios[0]),
          folder,
          filename,
          task,
        });
        return {ok: true, events: [{kind: 'success', text: `音频已就绪: ${installed}`}]};
      } catch (error) {
        return {ok: false, events: [{kind: 'error', text: error.message}]};
      } finally {
        fs.rmSync(tempDir, {recursive: true, force: true});
      }
    },
  };
};

/**
 * 按 kind 分派出命令、参数和进度来源.
 * @param {{kind: string, folder: string, options?: object, tempParent?: string}} params
 */
export const buildJobSpec = ({kind, folder, options = {}, tempParent = os.tmpdir()}) => {
  if (kind === 'fetch-audio') return buildFetchAudioSpec({folder, options, tempParent});

  const {argv, env} = buildJobInvocation({kind, folder, options});
  return {
    command: process.execPath,
    args: [TSUZURI_ENTRY, ...argv],
    stdio: ['ignore', 'pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      TSUZURI_JSON_PROGRESS: '1',
      ...env,
    },
    progressSource: 'fd3',
    finalize: null,
    // Job leases always claim the project itself. Keep output paths explicit in
    // the spec so callers that need narrower future output claims have one API.
    outputPaths: kind === 'render'
      ? [resolveRenderOutputPath({
        folder,
        output: options.output ?? null,
        exif: options.exif,
        sign: options.sign,
        dark: options.dark,
        portrait: options.format === 'portrait',
        square: options.format === 'square',
        draft: options.draft,
        filter: options.filter ? {id: options.filter, ...(options.filterIntensity != null ? {intensity: options.filterIntensity} : {})} : null,
        filterConfig: readFilterConfig(folder),
        photoNames: fs.existsSync(folder) ? scanFolderLoose(folder).photos : [],
      })]
      : kind === 'still'
        ? resolveJobs(folder, options.output ?? null, {
          exif: options.exif, sign: options.sign, dark: options.dark,
          portrait: options.format === 'portrait', square: options.format === 'square',
          filter: options.filter ? {id: options.filter, ...(options.filterIntensity != null ? {intensity: options.filterIntensity} : {})} : null,
        }).jobs.map((job) => job.outPath)
        : [],
  };
};
