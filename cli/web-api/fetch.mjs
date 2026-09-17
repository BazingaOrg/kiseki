/** 在线素材端点。外部命令使用异步 spawn，解析规则复用 CLI 纯函数。 */
import {spawn as spawnActual} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import {FIXES} from '../dependencies.mjs';
import {
  buildLyricsQuery,
  canonicalLyricsId,
  compareLyricsDurationDelta,
  durationDelta,
  filterSyncedRecords,
  AMLL_TTML_MAX_BYTES,
  installDownloadedLyrics,
  parseCurlResponse,
  probeAudio,
  resolveAmllLyrics,
  safeAmllLyricsFilename,
  searchLyricsRecords,
  searchAmllItems,
  selectLyricsCandidatesBySource,
} from '../fetch.mjs';
import {normalizeAmllCandidate} from '../amll.mjs';
import {preferSimplifiedChineseLrc} from '../lrc.mjs';
import {parseLrc} from '../lrc.mjs';
import {scanFolderLoose} from '../project.mjs';
import {AUDIO_PROVIDER_LIMIT, checkYtDlp, normalizeSearchQuery, parseSearchCandidates} from '../ytdlp.mjs';
import {resolveSafePath} from './sandbox.mjs';
import {assertNoRunningJob, withProjectMutationLock} from './assets.mjs';
import {createTaskLeaseManager, ProjectBusyError} from '../task-lease.mjs';
import {shiftLrc, validateLyricsAlignment} from './lyrics-validation.mjs';
import {sourceRuntimeLayout} from '../runtime-layout.mjs';
import {createNodeCommandResolver} from '../command-resolver.mjs';
import {createProcessCompletion} from './process-lifecycle.mjs';

const LRCLIB_BASE = 'https://lrclib.net/api';
const AMLL_BASE = 'https://api.amll.dev/v1/lyrics';
// LRCLIB 要求调用方带可识别的 User-Agent(与 cli/fetch.mjs 保持一致)
const LRCLIB_UA = 'kiseki (https://github.com/BazingaOrg/kiseki)';
const DEFAULT_TIMEOUT_MS = 20000;
const validationRecognitionCache = new Map();
const candidateDetailCache = new Map();
const amllFilenameById = new Map();
export const resetFetchState = () => {
  validationRecognitionCache.clear();
  candidateDetailCache.clear();
  amllFilenameById.clear();
};

/**
 * 异步跑一个外部命令,把结果整理成 spawnSync 那样的 {status, stdout, stderr},
 * 这样就能直接喂给 cli/ 里那些"接受可注入 spawn"的纯解析函数.
 * 任何失败(命令不存在、超时、被杀)一律归一成 status: null,调用方只看 status.
 * @returns {Promise<{status: number|null, stdout: string, stderr: string}>}
 */
export const runProcess = (command, args, {timeout = DEFAULT_TIMEOUT_MS, spawnImpl = spawnActual, env, signal, lifecycle, platform} = {}) =>
  new Promise((resolve) => {
    if (signal?.aborted) {
      resolve({status: null, stdout: '', stderr: ''});
      return;
    }
    let child;
    try {
      child = spawnImpl(command, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true,
        ...(process.platform === 'win32' ? {windowsHide: true} : {}),
        ...(env ? {env} : {}),
      });
    } catch {
      resolve({status: null, stdout: '', stderr: ''});
      return;
    }
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timer;
    const completion = createProcessCompletion({
      pid: child.pid,
      platform,
      lifecycle,
      settle: () => done({status: null, stdout, stderr}),
    });
    const abort = () => completion.requestTermination();
    const done = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      resolve(result);
    };
    // 没有超时兜底的话,一个卡住的 yt-dlp/curl 会让这个请求永远挂着,
    // 浏览器那边就是一个转不完的圈.
    timer = setTimeout(() => {
      completion.requestTermination();
    }, timeout);
    timer.unref?.();
    signal?.addEventListener('abort', abort, {once: true});
    if (signal?.aborted) abort();
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', () => {
      if (!child.pid) done({status: null, stdout, stderr});
    });
    child.on('close', (code) => {
      if (!completion.close()) done({status: code, stdout, stderr});
    });
  });

/** 复用 checkYtDlp 的判定(它的 spawn 参数可注入),只是把结果换成异步取的. */
export const checkYtDlpAsync = async (run = runProcess, runtime = sourceRuntimeLayout) => {
  const result = await run(runtime.ytDlp, ['--version'], {timeout: 5000});
  return checkYtDlp(() => result);
};

/** 复用 parseSearchLine 的行解析,搜索参数与 cli/ytdlp.mjs 的 searchYtDlp 一致. */
export const searchYtDlpAsync = async (query, run = runProcess, runtime = sourceRuntimeLayout) => {
  const normalized = normalizeSearchQuery(query);
  const result = await run(runtime.ytDlp, [
    `ytsearch${AUDIO_PROVIDER_LIMIT}:${normalized}`,
    '--flat-playlist',
    '--print', '%(id)s\t%(title)s\t%(duration_string)s\t%(channel,uploader)s',
  ]);
  if (result.status !== 0) return {ok: false, stderr: (result.stderr ?? '').trim()};
  return {ok: true, candidates: parseSearchCandidates(result.stdout)};
};

const normalizeMatchText = (value) => String(value ?? '')
  .normalize('NFKC')
  .toLocaleLowerCase()
  .replace(/[\s\p{P}\p{S}]+/gu, '');

const textMatchScore = (candidate, expected) => {
  const left = normalizeMatchText(candidate);
  const right = normalizeMatchText(expected);
  if (!left || !right) return 0;
  if (left === right) return 3;
  if (left.includes(right) || right.includes(left)) return 2;
  return 0;
};

export const rankWebLyricsCandidates = (records, {audioDuration, title, artist}) => {
  const seen = new Set();
  const candidates = (Array.isArray(records) ? records : []).flatMap((record, index) => {
    if (record?.provider !== 'amll' && filterSyncedRecords([record]).length === 0) return [];
    const id = canonicalLyricsId(record.id);
    const identity = id === null ? null : `${record.provider ?? 'lrclib'}:${id}`;
    if (identity === null || seen.has(identity)) return [];
    seen.add(identity);
    const titleScore = textMatchScore(record.trackName, title);
    const artistScore = textMatchScore(record.artistName, artist);
    return [{record, id, delta: durationDelta(record.duration, audioDuration), matchScore: titleScore * 2 + artistScore, index}];
  });
  candidates.sort((left, right) => {
    if (left.matchScore !== right.matchScore) return right.matchScore - left.matchScore;
    return compareLyricsDurationDelta(left.delta, right.delta) || left.index - right.index;
  });
  return selectLyricsCandidatesBySource(candidates, ({record}) => record.provider ?? 'lrclib');
};

/** 复用 probeAudio 的 tag/时长解析(同样靠注入 spawn 把同步调用换成异步取值). */
export const probeAudioAsync = async (file, run = runProcess, runtime = sourceRuntimeLayout) => {
  const result = await run(
    runtime.ffprobe,
    ['-v', 'error', '-show_entries', 'format=duration:format_tags=title,artist', '-of', 'json', file],
    {timeout: 10000},
  );
  return probeAudio(file, () => result);
};

const identityFromFilename = (audio) => {
  const base = path.basename(audio, path.extname(audio));
  const separator = base.lastIndexOf(' - ');
  return separator > 0
    ? {title: base.slice(0, separator).trim(), artist: base.slice(separator + 3).trim()}
    : {title: base.trim(), artist: null};
};

const recognizeForValidation = async (audioPath, run = runProcess, commandResolver = createNodeCommandResolver()) => {
  const temporary = fs.mkdtempSync(path.join(commandResolver.runtime.tempRoot, 'kiseki-lyrics-validation-'));
  const output = path.join(temporary, 'recognized.json');
  try {
    const command = commandResolver.analyzer('kiseki-analyze', [
      audioPath,
      '--lyrics-only', '--lyrics-output', output,
    ]);
    const result = await run(command.executable, command.args, {timeout: 180000, env: command.env});
    if (result.status !== 0 || !fs.existsSync(output)) throw new Error('本地识别未完成');
    const parsed = JSON.parse(fs.readFileSync(output, 'utf8'));
    return Array.isArray(parsed?.segments) ? parsed.segments : [];
  } finally {
    fs.rmSync(temporary, {recursive: true, force: true});
  }
};

/**
 * LRCLIB 请求的异步版.仍然走 curl(跟随系统代理环境变量,与 CLI 行为一致),
 * 响应解析复用 parseCurlResponse.签名与 cli/fetch.mjs 的 lrclibFetch 相同,
 * 可以直接作为 searchLyricsRecords 的 fetcher 传入.
 */
export const createLrclibFetch = (run = runProcess, runtime = sourceRuntimeLayout) => async (pathname, params = {}) => {
  const url = new URL(`${LRCLIB_BASE}${pathname}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined) url.searchParams.set(key, value);
  }
  const result = await run(runtime.curl, [
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

export const createAmllFetch = (run = runProcess, runtime = sourceRuntimeLayout) => async (pathname, params = {}) => {
  const url = new URL(`${AMLL_BASE}${pathname}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined) url.searchParams.set(key, value);
  }
  const result = await run(runtime.curl, [
    '-sS', '--max-time', '20', '--max-filesize', '1048576', '-w', '\n%{http_code}', url.toString(),
  ]);
  const parsed = parseCurlResponse(result.stdout);
  if (result.status !== 0 || !parsed) throw new Error((result.stderr ?? '').trim().split('\n').pop() || '请求失败');
  if (parsed.status === 404) return null;
  if (parsed.status < 200 || parsed.status >= 300) throw new Error(`AMLL 返回 ${parsed.status}`);
  const payload = JSON.parse(parsed.body);
  if (payload?.status !== undefined && payload.status !== 200) throw new Error(`AMLL 返回 ${payload.status}`);
  return payload?.data ?? payload;
};

const normalizeLyricsProvider = (provider) => {
  if (provider === undefined || provider === null || provider === '') return 'lrclib';
  return provider === 'lrclib' || provider === 'amll' ? provider : null;
};

const sourceNameFor = (provider) => provider === 'amll' ? 'AMLL' : 'LRCLIB';

const rememberAmllFilename = (id, filename) => {
  const safe = safeAmllLyricsFilename(filename);
  if (id && safe) amllFilenameById.set(id, safe);
  return safe;
};

const loadCandidateDetail = async (provider, requestedId, {fetcher, amllFetcher, run, runtime, filename}) => {
  if (provider === 'lrclib') {
    const record = await (fetcher ?? createLrclibFetch(run, runtime))(`/get/${requestedId}`, {});
    if (filterSyncedRecords(record ? [record] : []).length === 0) return null;
    if (canonicalLyricsId(record.id) !== requestedId) throw new Error('LRCLIB 返回的记录 id 与请求不一致');
    const lines = parseLrc(record.syncedLyrics);
    return {
      ...record,
      provider: 'lrclib',
      sourceName: sourceNameFor('lrclib'),
      translationCount: lines.filter(({translation}) => translation).length,
      lineCount: lines.length,
    };
  }
  const {raw, parsed} = await resolveAmllLyrics(
    {id: requestedId, filename},
    {
      amllFetcher: amllFetcher ?? createAmllFetch(run, runtime),
      requestUrl: (url) => run(runtime.curl, ['-sS', '--max-time', '20', '--max-filesize', String(AMLL_TTML_MAX_BYTES), '-w', '\n%{http_code}', url]),
    },
  );
  if (!parsed.syncedLyrics) return null;
  const authors = Array.isArray(raw.authorUsernames) ? raw.authorUsernames : [raw.authorUsernames];
  return {
    ...normalizeAmllCandidate(raw),
    ...parsed,
    provider: 'amll',
    sourceName: sourceNameFor('amll'),
    authors: authors.filter((author) => typeof author === 'string' && author.trim()),
  };
};

const fetchCandidateDetail = async (provider, requestedId, {fetcher, amllFetcher, run, runtime, filename} = {}) => {
  const safeFilename = rememberAmllFilename(requestedId, filename) ?? amllFilenameById.get(requestedId);
  const cacheKey = `${provider}:${requestedId}`;
  const cached = candidateDetailCache.get(cacheKey);
  if (cached) return cached;
  const pending = (async () => {
    try {
      return await loadCandidateDetail(provider, requestedId, {fetcher, amllFetcher, run, runtime, filename: safeFilename});
    } catch (error) {
      candidateDetailCache.delete(cacheKey);
      throw error;
    }
  })();
  candidateDetailCache.set(cacheKey, pending);
  return pending;
};

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
export const searchLyricsCandidates = async (root, folderParam, {run = runProcess, fetcher, amllFetcher, query: queryOverride, runtime = sourceRuntimeLayout} = {}) => {
  const resolved = resolveAudioFolder(root, folderParam);
  if (resolved.error) return resolved.error;
  const {folder, audio} = resolved;

  const probe = await probeAudioAsync(path.join(folder, audio), run, runtime);
  const inferred = identityFromFilename(audio);
  const expectedTitle = probe.title || inferred.title;
  const expectedArtist = probe.artist || inferred.artist;
  const override = normalizeSearchQuery(queryOverride);
  const query = override || normalizeSearchQuery(buildLyricsQuery({title: expectedTitle, artist: expectedArtist, audioFile: audio}));
  const useInjectedFetchers = fetcher !== undefined || amllFetcher !== undefined;
  const requests = [];
  if (!useInjectedFetchers || fetcher !== undefined) {
    requests.push(['lrclib', async () => searchLyricsRecords(
      // customized 必须跟着用户是否手输关键词走:searchLyricsRecords 在
      // !customized 且 tag 齐全时会先打 /get 精确查询并直接返回,query 根本用不上.
      // tag 写错(标题是专辑名、翻唱版本)恰恰是用户要手动改词的主要场景,
      // 不传这个标志的话"再找一次"永远返回同一批错结果.
      {query, title: probe.title, artist: probe.artist, duration: probe.duration, customized: Boolean(override), requireValidId: true},
      fetcher ?? createLrclibFetch(run, runtime),
    )]);
  }
  if (!useInjectedFetchers || amllFetcher !== undefined) {
    requests.push(['amll', async () => {
      const items = await searchAmllItems(amllFetcher ?? createAmllFetch(run, runtime), {
        query,
        title: probe.title,
        artist: probe.artist,
        customized: Boolean(override),
      });
      return items.map(normalizeAmllCandidate);
    }]);
  }
  const settled = await Promise.all(requests.map(async ([provider, request]) => {
    try {
      return {provider, status: 'fulfilled', records: await request()};
    } catch (error) {
      return {provider, status: 'rejected', error};
    }
  }));
  const records = settled.flatMap(({status, records: sourceRecords}) => status === 'fulfilled' ? sourceRecords : []);
  const warnings = settled.flatMap(({status, provider, error}) => status === 'rejected' ? [`${sourceNameFor(provider)} 搜索失败: ${error.message}`] : []);
  if (records.length === 0 && settled.every(({status}) => status === 'rejected')) {
    return {status: 502, body: {error: `歌词搜索失败: ${warnings.join('；')}`}};
  }

  const synced = rankWebLyricsCandidates(records, {audioDuration: probe.duration, title: expectedTitle, artist: expectedArtist});
  return {
    status: 200,
    body: {
      query,
      ...(warnings.length > 0 ? {warnings} : {}),
      candidates: synced.map(({record, id, delta, matchScore}) => {
        const filename = record.provider === 'amll' ? rememberAmllFilename(id, record.filename) : null;
        return {
          id,
          ...(record.provider === 'amll' ? {
            provider: 'amll',
            sourceName: sourceNameFor('amll'),
            ...(record.albumName ? {album: record.albumName} : {}),
            ...(filename ? {filename} : {}),
          } : {}),
          title: record.trackName,
          artist: record.artistName,
          duration: record.duration,
          delta,
          metadataMatch: matchScore >= 4,
          // filterSyncedRecords 之后一定是带时间轴的,这个字段恒为 true,留着是为了
          // 前端不必假设过滤规则.不下发 CLI 那句成品文案:那是终端排版,网页拿
          // delta 自己组织更合适,多一个没人消费的字段只会变成漂移源.
          synced: true,
        };
      }),
    },
  };
};

/** POST /api/fetch/lyrics-validate {folder,id}:保存前用本地人声锚点验证候选版本。 */
export const validateLyricsCandidate = async (root, body, {run = runProcess, fetcher, amllFetcher, recognize, isJobRunning, runtime = sourceRuntimeLayout, commandResolver = createNodeCommandResolver({runtime})} = {}) => {
  const requestedId = canonicalLyricsId(body?.id);
  if (requestedId === null) return {status: 400, body: {error: 'id 必须是数字', field: 'id'}};
  const provider = normalizeLyricsProvider(body?.provider);
  if (provider === null) return {status: 400, body: {error: 'provider 不支持', field: 'provider'}};
  const resolved = resolveAudioFolder(root, body?.folder);
  if (resolved.error) return resolved.error;
  if (isJobRunning?.()) return {status: 409, body: {error: '任务运行中，暂不校验歌词'}};
  let record;
  try {
    record = await fetchCandidateDetail(provider, requestedId, {fetcher, amllFetcher, run, runtime, filename: body?.filename});
  } catch (error) {
    return {status: 502, body: {error: `取歌词失败: ${error.message}`}};
  }
  if (!record) return {status: 404, body: {error: '这条记录没有同步歌词'}};
  let segments;
  try {
    if (recognize) segments = await recognize(path.join(resolved.folder, resolved.audio), run);
    else {
      const cacheKey = `${resolved.folder}:${resolved.audioIdentity}`;
      let recognition = validationRecognitionCache.get(cacheKey);
      if (!recognition) {
        recognition = recognizeForValidation(path.join(resolved.folder, resolved.audio), run, commandResolver);
        validationRecognitionCache.set(cacheKey, recognition);
        recognition.catch(() => validationRecognitionCache.delete(cacheKey));
      }
      segments = await recognition;
    }
  } catch (error) {
    return {status: 500, body: {error: `时间轴校验失败: ${error.message}`}};
  }
  const validation = validateLyricsAlignment(segments, parseLrc(record.syncedLyrics));
  return {status: 200, body: {...validation, anchorCount: validation.anchors.length}};
};

export const fetchLyricsPreview = async (root, folderParam, id, providerParam, {run = runProcess, fetcher, amllFetcher, runtime = sourceRuntimeLayout, filename} = {}) => {
  const requestedId = canonicalLyricsId(id);
  if (requestedId === null) return {status: 400, body: {error: 'id 必须是数字', field: 'id'}};
  const provider = normalizeLyricsProvider(providerParam);
  if (provider === null) return {status: 400, body: {error: 'provider 不支持', field: 'provider'}};
  const resolved = resolveAudioFolder(root, folderParam);
  if (resolved.error) return resolved.error;
  let record;
  try {
    record = await fetchCandidateDetail(provider, requestedId, {fetcher, amllFetcher, run, runtime, filename});
  } catch (error) {
    return {status: 502, body: {error: `取歌词失败: ${error.message}`}};
  }
  if (!record) return {status: 404, body: {error: '这条记录没有同步歌词'}};
  const preferred = await preferSimplifiedChineseLrc(record.syncedLyrics);
  const timeline = parseLrc(preferred.lyrics, {keepGaps: true});
  const lines = timeline.flatMap((entry, index) => entry.text ? [{
    time: entry.time,
    text: entry.text,
    ...(entry.translation ? {translation: entry.translation} : {}),
    ...(Number.isFinite(timeline[index + 1]?.time) ? {until: timeline[index + 1].time} : {}),
  }] : []);
  return {status: 200, body: {
    lines,
    provider,
    translationCount: record.translationCount ?? lines.filter(({translation}) => translation).length,
    lineCount: record.lineCount ?? lines.length,
    sourceName: record.sourceName ?? sourceNameFor(provider),
    ...(Array.isArray(record.authors) && record.authors.length > 0 ? {authors: record.authors} : {}),
    ...(Array.isArray(record.warnings) && record.warnings.length > 0 ? {warnings: record.warnings} : {}),
  }};
};

/**
 * POST /api/fetch/lyrics {folder, id}
 * id 是 LRCLIB 记录 id,按 id 重新取一次歌词正文(不在服务端缓存搜索结果),
 * 与 CLI 一样做繁转简,最后复用 installDownloadedLyrics 落到 audio/.
 */
export const saveLyrics = async (root, body, {run = runProcess, fetcher, amllFetcher, isJobRunning, leaseManager = createTaskLeaseManager(), runtime = sourceRuntimeLayout} = {}) => {
  const id = body?.id;
  const requestedId = canonicalLyricsId(id);
  if (requestedId === null) {
    return {status: 400, body: {error: 'id 必须是数字', field: 'id'}};
  }
  const provider = normalizeLyricsProvider(body?.provider);
  if (provider === null) return {status: 400, body: {error: 'provider 不支持', field: 'provider'}};
  const resolved = resolveAudioFolder(root, body?.folder);
  if (resolved.error) return resolved.error;
  const {folder, audio, audioIdentity, existingLrc, lrcIdentity} = resolved;

  let record;
  try {
    record = await fetchCandidateDetail(provider, requestedId, {fetcher, amllFetcher, run, runtime, filename: body?.filename});
  } catch (error) {
    return {status: 502, body: {error: `取歌词失败: ${error.message}`}};
  }
  if (!record) {
    return {status: 404, body: {error: '这条记录没有同步歌词'}};
  }
  const requestedOffset = Number(body?.offset ?? 0);
  if (!Number.isFinite(requestedOffset) || Math.abs(requestedOffset) > 30) {
    return {status: 400, body: {error: '歌词偏移必须在 ±30 秒内', field: 'offset'}};
  }
  let preferred;
  try {
    preferred = await preferSimplifiedChineseLrc(shiftLrc(record.syncedLyrics, requestedOffset));
    parseLrc(preferred.lyrics, {keepGaps: true});
  } catch (error) {
    return {status: 502, body: {error: error.message}};
  }
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
      return {status: 200, body: {ok: true, file, converted: preferred.converted, provider, translationCount: record.translationCount ?? 0}};
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
export const searchAudioCandidates = async (query, {run = runProcess, runtime = sourceRuntimeLayout} = {}) => {
  const normalized = typeof query === 'string' ? normalizeSearchQuery(query) : '';
  if (!normalized) {
    return {status: 400, body: {error: 'q 不能为空', field: 'q'}};
  }
  const ytdlp = await checkYtDlpAsync(run, runtime);
  if (!ytdlp.ok) {
    // 503 而不是 500:这不是服务出错,是缺一个用户自装的可选依赖,前端要能直接
    // 把 fix 文案显示成"怎么补".
    return {status: 503, body: {error: '未找到 yt-dlp(下载音频需要它,由你自行安装)', fix: FIXES['yt-dlp']}};
  }
  const result = await searchYtDlpAsync(normalized, run, runtime);
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
