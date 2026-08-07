/**
 * 在线取音频/歌词的"快"端点(契约 C):LRCLIB 搜索是一次 HTTP 往返、写 .lrc 是一次
 * 文件写,都在百毫秒级,不值得走任务系统;真正分钟级的下载/识别走 /api/jobs.
 *
 * 决策逻辑一行都不重写,全部复用 cli/fetch.mjs 与 cli/ytdlp.mjs 已导出的纯函数.
 * 唯一新增的是**异步进程封装**:那两个模块里的 checkYtDlp / searchYtDlp / probeAudio /
 * lrclibFetch 内部都是 spawnSync,在 HTTP handler 里直接调用会把单线程 server 整个
 * 卡住(/api/doctor 已经为此吃过亏).这里用 child_process.spawn 的异步形式重新包一层,
 * 再把收集到的结果**喂回那些函数的解析逻辑**(它们的 spawn 参数是可注入的,或者解析部分
 * 单独导出了),所以解析规则只有一份.cli/ytdlp.mjs 的同步实现保持不动,CLI 还在用.
 */
import {spawn as spawnActual} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import {FIXES} from '../dependencies.mjs';
import {
  buildLyricsQuery,
  canonicalLyricsId,
  durationDelta,
  filterSyncedRecords,
  installDownloadedLyrics,
  LYRICS_SEARCH_LIMIT,
  parseCurlResponse,
  probeAudio,
  searchLyricsRecords,
} from '../fetch.mjs';
import {preferSimplifiedChineseLrc} from '../lrc.mjs';
import {scanFolderLoose} from '../project.mjs';
import {AUDIO_PROVIDER_LIMIT, checkYtDlp, normalizeSearchQuery, parseSearchCandidates} from '../ytdlp.mjs';
import {resolveSafePath} from './sandbox.mjs';
import {assertNoRunningJob, withProjectMutationLock} from './assets.mjs';
import {createTaskLeaseManager, ProjectBusyError} from '../task-lease.mjs';

const LRCLIB_BASE = 'https://lrclib.net/api';
// LRCLIB 要求调用方带可识别的 User-Agent(与 cli/fetch.mjs 保持一致)
const LRCLIB_UA = 'tsuzuri (https://github.com/tsuzuri)';
const DEFAULT_TIMEOUT_MS = 20000;

/**
 * 异步跑一个外部命令,把结果整理成 spawnSync 那样的 {status, stdout, stderr},
 * 这样就能直接喂给 cli/ 里那些"接受可注入 spawn"的纯解析函数.
 * 任何失败(命令不存在、超时、被杀)一律归一成 status: null,调用方只看 status.
 * @returns {Promise<{status: number|null, stdout: string, stderr: string}>}
 */
export const runProcess = (command, args, {timeout = DEFAULT_TIMEOUT_MS, spawnImpl = spawnActual} = {}) =>
  new Promise((resolve) => {
    let child;
    try {
      child = spawnImpl(command, args, {stdio: ['ignore', 'pipe', 'pipe']});
    } catch {
      resolve({status: null, stdout: '', stderr: ''});
      return;
    }
    let stdout = '';
    let stderr = '';
    let settled = false;
    const done = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    // 没有超时兜底的话,一个卡住的 yt-dlp/curl 会让这个请求永远挂着,
    // 浏览器那边就是一个转不完的圈.
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        // 已经退出了,忽略
      }
      done({status: null, stdout, stderr});
    }, timeout);
    timer.unref?.();
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', () => done({status: null, stdout, stderr}));
    child.on('close', (code) => done({status: code, stdout, stderr}));
  });

/** 复用 checkYtDlp 的判定(它的 spawn 参数可注入),只是把结果换成异步取的. */
export const checkYtDlpAsync = async (run = runProcess) => {
  const result = await run('yt-dlp', ['--version'], {timeout: 5000});
  return checkYtDlp(() => result);
};

/** 复用 parseSearchLine 的行解析,搜索参数与 cli/ytdlp.mjs 的 searchYtDlp 一致. */
export const searchYtDlpAsync = async (query, run = runProcess) => {
  const normalized = normalizeSearchQuery(query);
  const result = await run('yt-dlp', [
    `ytsearch${AUDIO_PROVIDER_LIMIT}:${normalized}`,
    '--flat-playlist',
    '--print', '%(id)s\t%(title)s\t%(duration_string)s\t%(channel,uploader)s',
  ]);
  if (result.status !== 0) return {ok: false, stderr: (result.stderr ?? '').trim()};
  return {ok: true, candidates: parseSearchCandidates(result.stdout)};
};

const rankWebLyricsCandidates = (records, audioDuration) => {
  const seen = new Set();
  const candidates = filterSyncedRecords(records).flatMap((record, index) => {
    const id = canonicalLyricsId(record.id);
    if (id === null || seen.has(id)) return [];
    seen.add(id);
    return [{record, id, delta: durationDelta(record.duration, audioDuration), index}];
  });
  candidates.sort((left, right) => {
    if (left.delta === null) return right.delta === null ? left.index - right.index : 1;
    if (right.delta === null) return -1;
    return left.delta - right.delta || left.index - right.index;
  });
  return candidates.slice(0, LYRICS_SEARCH_LIMIT);
};

/** 复用 probeAudio 的 tag/时长解析(同样靠注入 spawn 把同步调用换成异步取值). */
export const probeAudioAsync = async (file, run = runProcess) => {
  const result = await run(
    'ffprobe',
    ['-v', 'error', '-show_entries', 'format=duration:format_tags=title,artist', '-of', 'json', file],
    {timeout: 10000},
  );
  return probeAudio(file, () => result);
};

/**
 * LRCLIB 请求的异步版.仍然走 curl(跟随系统代理环境变量,与 CLI 行为一致),
 * 响应解析复用 parseCurlResponse.签名与 cli/fetch.mjs 的 lrclibFetch 相同,
 * 可以直接作为 searchLyricsRecords 的 fetcher 传入.
 */
export const createLrclibFetch = (run = runProcess) => async (pathname, params = {}) => {
  const url = new URL(`${LRCLIB_BASE}${pathname}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined) url.searchParams.set(key, value);
  }
  const result = await run('curl', [
    '-sS', '--max-time', '20', '-H', `User-Agent: ${LRCLIB_UA}`, '-w', '\n%{http_code}', url.toString(),
  ]);
  const parsed = parseCurlResponse(result.stdout);
  if (result.status !== 0 || !parsed) {
    throw new Error((result.stderr ?? '').trim().split('\n').pop() || '请求失败');
  }
  if (parsed.status === 404) return null;
  if (parsed.status < 200 || parsed.status >= 300) throw new Error(`LRCLIB 返回 ${parsed.status}`);
  return JSON.parse(parsed.body);
};

// ---------------------------------------------------------------------------
// 端点
// ---------------------------------------------------------------------------

/** 三个端点共用:把 folder 过沙箱并确认是目录,顺带定位唯一音频. */
const resolveAudioFolder = (root, folderParam) => {
  const folder = resolveSafePath(root, folderParam);
  if (folder === null) return {error: {status: 403, body: {error: '路径越界'}}};
  let isDirectory = false;
  try {
    isDirectory = fs.statSync(folder).isDirectory();
  } catch {
    isDirectory = false;
  }
  if (!isDirectory) return {error: {status: 400, body: {error: 'folder 不是一个存在的目录'}}};
  const {audios, lyrics} = scanFolderLoose(folder);
  // 歌词要按时长匹配、按音频名落盘,没有唯一音频就无从谈起(与 CLI 的判断一致).
  if (audios.length !== 1) {
    return {error: {status: 400, body: {error: '需要文件夹里恰好有一个音频文件'}}};
  }
  if (lyrics.length > 1) return {error: {status: 409, body: {error: '文件夹里有多份歌词,请先保留唯一的一份'}}};
  const audioPath = path.join(folder, audios[0]);
  let audioIdentity;
  try {
    const stat = fs.lstatSync(audioPath);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('unsafe');
    audioIdentity = `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}`;
  } catch {
    return {error: {status: 409, body: {error: '音频文件已变化,请重新搜索'}}};
  }
  const existingLrc = lyrics[0] ?? null;
  let lrcIdentity = null;
  if (existingLrc) {
    try {
      const stat = fs.lstatSync(path.join(folder, existingLrc));
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('unsafe');
      lrcIdentity = `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}`;
    } catch {
      return {error: {status: 409, body: {error: '歌词文件已变化,请重新搜索'}}};
    }
  }
  return {folder, audio: audios[0], audioIdentity, existingLrc, lrcIdentity};
};

/**
 * GET /api/fetch/lyrics-search?folder=<abs>&q=<可选关键词>
 * 不传 q 时查询词由 buildLyricsQuery 从音频 tag / 文件名推出,时长用 ffprobe 取.
 * q 是必要的补救路径:文件名乱七八糟时自动推断必然猜错,CLI 里也允许重新输关键词
 * 再搜一次,没有它用户就只能去改文件名.
 */
export const searchLyricsCandidates = async (root, folderParam, {run = runProcess, fetcher, query: queryOverride} = {}) => {
  const resolved = resolveAudioFolder(root, folderParam);
  if (resolved.error) return resolved.error;
  const {folder, audio} = resolved;

  const probe = await probeAudioAsync(path.join(folder, audio), run);
  const override = normalizeSearchQuery(queryOverride);
  const query = override || normalizeSearchQuery(buildLyricsQuery({title: probe.title, artist: probe.artist, audioFile: audio}));
  let records;
  try {
    records = await searchLyricsRecords(
      // customized 必须跟着用户是否手输关键词走:searchLyricsRecords 在
      // !customized 且 tag 齐全时会先打 /get 精确查询并直接返回,query 根本用不上.
      // tag 写错(标题是专辑名、翻唱版本)恰恰是用户要手动改词的主要场景,
      // 不传这个标志的话"再找一次"永远返回同一批错结果.
      {query, title: probe.title, artist: probe.artist, duration: probe.duration, customized: Boolean(override), requireValidId: true},
      fetcher ?? createLrclibFetch(run),
    );
  } catch (error) {
    // 网络/代理问题是这个端点最常见的失败,原文透给前端比一句"失败了"有用.
    return {status: 502, body: {error: `歌词搜索失败: ${error.message}`}};
  }

  const synced = rankWebLyricsCandidates(records, probe.duration);
  return {
    status: 200,
    body: {
      query,
      candidates: synced.map(({record, id, delta}) => ({
        id,
        title: record.trackName,
        artist: record.artistName,
        duration: record.duration,
        delta,
          // filterSyncedRecords 之后一定是带时间轴的,这个字段恒为 true,留着是为了
          // 前端不必假设过滤规则.不下发 CLI 那句成品文案:那是终端排版,网页拿
          // delta 自己组织更合适,多一个没人消费的字段只会变成漂移源.
        synced: true,
      })),
    },
  };
};

/**
 * POST /api/fetch/lyrics {folder, id}
 * id 是 LRCLIB 记录 id,按 id 重新取一次歌词正文(不在服务端缓存搜索结果),
 * 与 CLI 一样做繁转简,最后复用 installDownloadedLyrics 落到 audio/.
 */
export const saveLyrics = async (root, body, {run = runProcess, fetcher, isJobRunning, leaseManager = createTaskLeaseManager()} = {}) => {
  const id = body?.id;
  const requestedId = canonicalLyricsId(id);
  if (requestedId === null) {
    return {status: 400, body: {error: 'id 必须是数字', field: 'id'}};
  }
  const resolved = resolveAudioFolder(root, body?.folder);
  if (resolved.error) return resolved.error;
  const {folder, audio, audioIdentity, existingLrc, lrcIdentity} = resolved;

  let record;
  try {
    record = await (fetcher ?? createLrclibFetch(run))(`/get/${requestedId}`, {});
  } catch (error) {
    return {status: 502, body: {error: `取歌词失败: ${error.message}`}};
  }
  if (filterSyncedRecords(record ? [record] : []).length === 0) {
    return {status: 404, body: {error: '这条记录没有同步歌词'}};
  }
  if (canonicalLyricsId(record.id) !== requestedId) {
    return {status: 502, body: {error: 'LRCLIB 返回的记录 id 与请求不一致'}};
  }

  const preferred = await preferSimplifiedChineseLrc(record.syncedLyrics);
  const filename = `${path.basename(audio, path.extname(audio))}.lrc`;
  let lease;
  let response;
  try {
    // Search/download above deliberately holds no lease; claim only the final
    // identity-checked write, immediately before the in-process mutation lock.
    lease = leaseManager.acquire({kind: 'lyrics-save', resources: [folder]});
    response = withProjectMutationLock(folder, () => {
      assertNoRunningJob(isJobRunning);
      const current = resolveAudioFolder(root, body?.folder);
      if (current.error) return current.error;
      if (
        current.audio !== audio || current.audioIdentity !== audioIdentity ||
        current.existingLrc !== existingLrc || current.lrcIdentity !== lrcIdentity
      ) {
        return {status: 409, body: {error: '音频或歌词在下载期间已变化,请重新搜索'}};
      }
      const file = installDownloadedLyrics({
        lyrics: preferred.lyrics,
        folder,
        filename,
        existing: existingLrc,
        task: {lease, manager: leaseManager},
      });
      return {status: 200, body: {ok: true, file, converted: preferred.converted}};
    });
  } catch (error) {
    if (error instanceof ProjectBusyError) response = {status: 409, body: {error: '项目已有任务在执行'}};
    else if (error?.status === 409) response = {status: 409, body: {error: error.message}};
    else response = {status: 500, body: {error: `保存歌词失败: ${error.message}`}};
  }
  if (lease && !leaseManager.release(lease) && response?.status === 200) {
    return {status: 500, body: {error: '保存歌词失败: 任务 lease 释放失败'}};
  }
  return response;
};

/** GET /api/fetch/audio-search?q=<关键词> */
export const searchAudioCandidates = async (query, {run = runProcess} = {}) => {
  const normalized = typeof query === 'string' ? normalizeSearchQuery(query) : '';
  if (!normalized) {
    return {status: 400, body: {error: 'q 不能为空', field: 'q'}};
  }
  const ytdlp = await checkYtDlpAsync(run);
  if (!ytdlp.ok) {
    // 503 而不是 500:这不是服务出错,是缺一个用户自装的可选依赖,前端要能直接
    // 把 fix 文案显示成"怎么补".
    return {status: 503, body: {error: '未找到 yt-dlp(下载音频需要它,由你自行安装)', fix: FIXES['yt-dlp']}};
  }
  const result = await searchYtDlpAsync(normalized, run);
  if (!result.ok) {
    return {
      status: 502,
      body: {
        error: '搜索失败(常见原因:网络需要代理、yt-dlp 版本过旧)',
        detail: result.stderr.split('\n').slice(-3).join('\n'),
      },
    };
  }
  return {status: 200, body: {candidates: result.candidates}};
};
