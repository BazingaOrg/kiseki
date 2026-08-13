/** `kiseki fetch`:用 yt-dlp 与 LRCLIB 补齐可选的音频和同步歌词。 */

import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import {CliError} from './options.mjs';
import {FIXES} from './dependencies.mjs';
import {formatEquivalentCommand} from './command-format.mjs';
import {
  formatLrcPageTitle,
  formatLrcPreview,
  parseLrc,
  preferSimplifiedChineseLrc,
  PREVIEW_LINES,
} from './lrc.mjs';
import {PICK_BACK, withPrompts} from './prompts.mjs';
import {AUDIO_DIR, scanFolderLoose} from './project.mjs';
import {term} from './term.mjs';
import {checkYtDlp, downloadWithYtDlpProgress, searchYtDlp} from './ytdlp.mjs';
import {acquireCommandLease, createTaskLeaseManager} from './task-lease.mjs';
import {installAtomicOutputs} from './atomic-output.mjs';
import {sourceRuntimeLayout} from './runtime-layout.mjs';

const LRCLIB_BASE = 'https://lrclib.net/api';
// LRCLIB 要求调用方带可识别的 User-Agent
const LRCLIB_UA = 'kiseki (https://github.com/BazingaOrg/kiseki)';
// 歌词与音频时长差超过这个秒数,大概率是不同版本(live/剪辑),时间轴会错位
export const DURATION_WARN_SECONDS = 3;
export const LYRICS_SEARCH_LIMIT = 10;

export const formatDuration = (totalSeconds) => {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return '?:??';
  const rounded = Math.round(totalSeconds);
  const minutes = Math.floor(rounded / 60);
  const seconds = rounded % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
};

/** 生成跨平台安全的单个文件名片段. */
export const sanitizeFilePart = (value) =>
  String(value ?? '')
    .replace(/[\x00-\x1f<>:"/\\|?*]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
    .trim();

export const buildAudioFilename = ({title, artist, ext}) => {
  const cleanTitle = sanitizeFilePart(title);
  const cleanArtist = sanitizeFilePart(artist);
  if (!cleanTitle) throw new CliError('歌曲名不能为空');
  const suffix = String(ext ?? '').startsWith('.') ? String(ext) : `.${ext}`;
  return `${cleanTitle}${cleanArtist ? ` - ${cleanArtist}` : ''}${suffix.toLowerCase()}`;
};

/** 从 ffprobe tags / 文件名推默认歌词关键词. */
export const buildLyricsQuery = ({title, artist, audioFile}) => {
  if (title && artist) return `${title} ${artist}`;
  if (title) return title;
  const base = path.basename(audioFile ?? '', path.extname(audioFile ?? ''));
  return base.replace(/[_\-.]+/g, ' ').replace(/\s+/g, ' ').trim();
};

/** 歌词候选与音频时长差(秒);无法比较返回 null. */
export const durationDelta = (candidateSeconds, audioSeconds) => {
  if (!Number.isFinite(candidateSeconds) || !Number.isFinite(audioSeconds)) return null;
  return Math.abs(candidateSeconds - audioSeconds);
};

export const formatLyricsCandidate = (record, audioSeconds) => {
  const delta = durationDelta(record.duration, audioSeconds);
  const base = `${record.trackName} - ${record.artistName} (${formatDuration(record.duration)})`;
  if (delta !== null && delta > DURATION_WARN_SECONDS) {
    return `${base} ⚠ 与音频时长差 ${Math.round(delta)}s,时间轴可能错位`;
  }
  return base;
};

/** 只保留带同步时间轴的候选(纯文本歌词对踩点字幕没有用). */
export const filterSyncedRecords = (records) =>
  (Array.isArray(records) ? records : []).filter(
    (r) => r && typeof r.syncedLyrics === 'string' && r.syncedLyrics.trim() && !r.instrumental,
  );

/** LRCLIB 的 id 只能是十进制整数;数字类型也必须安全且非负. */
export const canonicalLyricsId = (id) => {
  if (typeof id === 'string') return /^\d+$/.test(id) ? id : null;
  if (typeof id === 'number' && Number.isSafeInteger(id) && id >= 0) return String(id);
  return null;
};

/** 保留 LRCLIB 返回顺序中的首个同 id 记录,随后才限制候选数. */
export const limitLyricsCandidates = (records) => {
  const seen = new Set();
  return filterSyncedRecords(records)
    .filter((record) => {
      const id = canonicalLyricsId(record.id);
      // CLI 直接保存候选里的歌词;没有 provider id 的两条候选不能因 undefined
      // 被误认为同一条.Web 层会在把候选下发给按 id 保存的 UI 前过滤它们.
      return id === null || (!seen.has(id) && seen.add(id));
    })
    .slice(0, LYRICS_SEARCH_LIMIT);
};

/** 解析 `curl -w '\n%{http_code}'` 的输出:末行是状态码,其余是 body. */
export const parseCurlResponse = (stdout) => {
  const text = String(stdout ?? '');
  const cut = text.lastIndexOf('\n');
  if (cut < 0) return null;
  const status = Number(text.slice(cut + 1).trim());
  if (!Number.isInteger(status) || status < 100) return null;
  return {status, body: text.slice(0, cut)};
};

/** 按文件夹现状决定兜底流程该提议什么(主流程只补缺,不打扰已备齐的). */
export const planOffers = ({audios, lyrics}) => ({
  offerAudio: audios.length === 0,
  offerLyrics: audios.length === 1 && lyrics.length === 0,
});

/**
 * 以 lease claim 派生的同目录 partial/backup 事务安装下载结果.
 * 不扫描或创建项目内 `.kiseki-fetch-*` 目录.
 */
const installFetchedFile = ({source = null, contents = null, folder, filename, existing = null, task = null}) => {
  const audioFolder = path.join(folder, AUDIO_DIR);
  const audioFolderExisted = fs.existsSync(audioFolder);
  fs.mkdirSync(audioFolder, {recursive: true});
  const destination = path.join(audioFolder, filename);
  const existingPath = existing ? path.join(folder, existing) : null;
  const destinationIsExisting = existingPath && path.resolve(existingPath) === path.resolve(destination);
  if (fs.existsSync(destination) && !destinationIsExisting) {
    throw new CliError(`目标文件已存在: ${filename}`);
  }

  const removePaths = existingPath && !destinationIsExisting ? [existingPath] : [];
  try {
    task?.manager.extendOutputClaims(task.lease, [destination, ...removePaths]);
    const transaction = task ? {
      prepare: (entries) => task.manager.prepareOutputTransaction(task.lease, entries),
      markCommitting: () => task.manager.setOutputTransactionPhase(task.lease, 'committing'),
      markCommitted: () => task.manager.setOutputTransactionPhase(task.lease, 'committed'),
      rollback: () => task.manager.rollbackOutputTransaction(task.lease),
      finalize: () => task.manager.finalizeOutputTransaction(task.lease),
    } : null;
    installAtomicOutputs({taskId: task?.lease.id, writes: [{finalPath: destination, source, contents}], deletes: removePaths, transaction});
    return path.posix.join(AUDIO_DIR, filename);
  } finally {
    if (!audioFolderExisted && fs.readdirSync(audioFolder).length === 0) {
      fs.rmdirSync(audioFolder);
    }
  }
};

export const installDownloadedAudio = (options) => installFetchedFile(options);

export const installDownloadedLyrics = ({lyrics, ...options}) =>
  installFetchedFile({...options, contents: lyrics});

/** 读音频 tag 与时长;ffprobe 失败不致命,返回空对象走文件名兜底. */
export const probeAudio = (file, spawn = spawnSync, runtime = sourceRuntimeLayout) => {
  const r = spawn(
    runtime.ffprobe,
    ['-v', 'error', '-show_entries', 'format=duration:format_tags=title,artist', '-of', 'json', file],
    {encoding: 'utf8'},
  );
  if (r.error || r.status !== 0) return {};
  try {
    const format = JSON.parse(r.stdout ?? '{}').format ?? {};
    const tags = Object.fromEntries(
      Object.entries(format.tags ?? {}).map(([k, v]) => [k.toLowerCase(), v]),
    );
    return {
      title: tags.title ?? null,
      artist: tags.artist ?? null,
      duration: Number.parseFloat(format.duration) || null,
    };
  } catch {
    return {};
  }
};

// 用 curl 而非 Node fetch:curl 跟随系统代理环境变量(http_proxy 等),
// 且与本项目 spawnSync 外部命令的风格一致;macOS 与 Windows 10+ 均自带.
const createLrclibFetch = (runtime = sourceRuntimeLayout) => (pathname, params) => {
  const url = new URL(`${LRCLIB_BASE}${pathname}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined) url.searchParams.set(key, value);
  }
  const r = spawnSync(
    runtime.curl,
    ['-sS', '--max-time', '20', '-H', `User-Agent: ${LRCLIB_UA}`, '-w', '\n%{http_code}', url.toString()],
    {encoding: 'utf8'},
  );
  if (r.error?.code === 'ENOENT') throw new Error('找不到命令 curl');
  const parsed = parseCurlResponse(r.stdout);
  if (r.error || r.status !== 0 || !parsed) {
    throw new Error((r.stderr ?? '').trim().split('\n').pop() || '请求失败');
  }
  if (parsed.status === 404) return null;
  if (parsed.status < 200 || parsed.status >= 300) throw new Error(`LRCLIB 返回 ${parsed.status}`);
  return JSON.parse(parsed.body);
};
const lrclibFetch = createLrclibFetch();

/** 精确记录必须真的含同步歌词;否则继续用关键词宽松搜索. */
export const searchLyricsRecords = async (
  {query, title, artist, duration, customized = false, requireValidId = false},
  fetcher = lrclibFetch,
) => {
  if (!customized && title && artist && duration) {
    const exact = await fetcher('/get', {
      track_name: title,
      artist_name: artist,
      duration: Math.round(duration),
    });
    const usable = filterSyncedRecords(exact ? [exact] : []).length > 0;
    if (usable && (!requireValidId || canonicalLyricsId(exact.id) !== null)) return [exact];
  }
  return await fetcher('/search', {q: query});
};

const NETWORK_HINT = '检查网络是否可达 lrclib.net(请求经 curl 发出,走系统代理设置)';

// ---------------------------------------------------------------------------
// 交互层
// ---------------------------------------------------------------------------

/** 音频下载子流程;成功时返回用户确认的文件名/歌曲信息. */
const audioFlow = async (ask, folder, {existing = null, task = null, runtime = sourceRuntimeLayout} = {}) => {
  const ytdlp = checkYtDlp(undefined, runtime);
  if (!ytdlp.ok) {
    term.error('未找到 yt-dlp(下载音频需要它,由你自行安装)');
    term.detail(FIXES['yt-dlp']);
    return false;
  }

  for (;;) {
    const input = await ask.line('粘贴歌曲 URL,或输入歌名搜索', {legend: ['回车 跳过']});
    if (!input) return false;

    let url = null;
    if (/^https?:\/\//i.test(input)) {
      url = input;
    } else {
      const searchTask = term.task(`搜索「${input}」`);
      const search = searchYtDlp(input, {runtime});
      if (!search.ok) {
        searchTask.fail();
        term.error('搜索失败');
        if (search.stderr) term.detail(search.stderr.split('\n').slice(-3).join('\n'));
        term.detail('常见原因:网络需要代理、yt-dlp 版本过旧(yt-dlp -U 可更新)');
        if (!(await ask.confirm('换个关键词再试?', {
          defaultValue: false, defaultLabel: '结束', alternateKey: 'r', alternateLabel: '重试',
        }))) return false;
        continue;
      }
      searchTask.succeed();
      if (search.candidates.length === 0) {
        term.warn(`没有找到「${input}」,换个关键词试试,或手动放入音频文件`);
        continue;
      }
      const choice = await ask.pick(
        '选择要下载的结果',
        search.candidates.map((c) => `${c.title} | ${c.duration} | ${c.uploader}`),
        {defaultIndex: 0, enterLabel: '下载第1个'},
      );
      if (choice === null) return false;
      if (choice === PICK_BACK) continue;
      const picked = search.candidates[choice.index];
      url = `https://www.youtube.com/watch?v=${picked.id}`;
    }

    const downloadTask = term.task('下载音频');
    downloadTask.endLine();
    const result = await downloadWithYtDlpProgress(url, {tempParent: task?.lease.taskRoot, runtime});
    if (!result.ok) {
      downloadTask.fail();
      term.error('下载失败');
      if (result.stderr) term.detail(result.stderr);
      term.detail('常见原因:网络需要代理、视频地区受限或已下架;可换一个结果或 URL');
      if (!(await ask.confirm('再试一次(可换关键词/URL)?', {
        defaultValue: false, defaultLabel: '结束', alternateKey: 'r', alternateLabel: '重试',
      }))) return false;
      continue;
    }
    downloadTask.succeed();

    try {
      for (const warning of result.warnings) term.warn(warning);
      term.info(`下载文件: ${result.audio}`);
      const probe = probeAudio(result.source, undefined, runtime);
      const sourceTitle = sanitizeFilePart(
        probe.title || path.basename(result.audio, path.extname(result.audio)),
      );
      term.detail(`来源视频: ${sourceTitle || result.audio}`);

      const defaultArtist = sanitizeFilePart(probe.artist ?? '') || undefined;
      for (;;) {
        const titleInput = await ask.line('歌曲名(用于文件名和歌词搜索)', {
          defaultValue: sourceTitle || undefined,
          enterLabel: '采用',
          validate: (value) => Boolean(sanitizeFilePart(value)) || '歌曲名不能为空',
        });
        const title = sanitizeFilePart(titleInput);
        const artistInput = await ask.line('歌手(可选,匹配更准)', {
          defaultValue: defaultArtist,
          enterLabel: '采用',
          allowBack: true,
          backLabel: '返回改歌名',
        });
        if (artistInput === PICK_BACK) continue;
        const artist = sanitizeFilePart(artistInput);
        const filename = buildAudioFilename({title, artist, ext: path.extname(result.audio)});
        term.detail(`保存文件: ${path.posix.join(AUDIO_DIR, filename)}`);
        if (!(await ask.confirm('歌曲信息和文件名正确吗?', {
          defaultLabel: '确认', alternateKey: 'r', alternateLabel: '修改',
        }))) continue;

        const destination = path.join(folder, AUDIO_DIR, filename);
        const sameAsExisting = existing && path.resolve(destination) === path.resolve(path.join(folder, existing));
        if (fs.existsSync(destination) && !sameAsExisting) {
          term.error(`目标文件已存在: ${filename}`);
          term.detail('请换一个歌曲名或歌手,不会静默覆盖');
          continue;
        }

        const installed = installDownloadedAudio({source: result.source, folder, filename, existing, task});
        term.success(`音频已就绪: ${installed}`);
        return {audio: installed, title, artist};
      }
    } finally {
      fs.rmSync(result.tempDir, {recursive: true, force: true});
    }
  }
};

/** 歌词搜索子流程;audio 必须存在(要按时长匹配、按音频名落盘). */
export const lyricsFlow = async (
  ask,
  out,
  folder,
  audio,
  {
    existingLrc = null,
    confirmedTitle = null,
    confirmedArtist = null,
    fetcher = lrclibFetch,
    task = null,
    runtime = sourceRuntimeLayout,
  } = {},
) => {
  const probe = probeAudio(path.join(folder, audio), undefined, runtime);
  if (fetcher === lrclibFetch && runtime !== sourceRuntimeLayout) fetcher = createLrclibFetch(runtime);
  const title = confirmedTitle || probe.title;
  const artist = confirmedArtist ?? probe.artist;
  const defaultQuery = buildLyricsQuery({title, artist, audioFile: audio});

  let query = defaultQuery;
  let queryCustomized = false;
  for (;;) {
    const input = await ask.line('歌词搜索关键词', {
      defaultValue: query,
      enterLabel: '搜索',
      allowBack: true,
    });
    if (input === PICK_BACK) return false;
    if (input !== query) {
      query = input;
      queryCustomized = true;
    }

    const lyricsSearchTask = term.task('搜索同步歌词(lrclib.net)');
    let records;
    try {
      records = await searchLyricsRecords({
        query,
        title,
        artist,
        duration: probe.duration,
        customized: queryCustomized,
      }, fetcher);
    } catch (error) {
      lyricsSearchTask.fail();
      term.error(`歌词搜索失败: ${error.message}`);
      term.detail(NETWORK_HINT);
      return false;
    }
    lyricsSearchTask.succeed();

    const synced = limitLyricsCandidates(records);
    if (synced.length === 0) {
      term.warn(`未找到「${query}」的同步歌词`);
      if (!(await ask.confirm('换个关键词再搜?', {
        defaultValue: false, defaultLabel: '结束', alternateKey: 'r', alternateLabel: '重搜',
      }))) return false;
      continue;
    }

    for (;;) {
      const choice = await ask.pick(
        '选择要预览的歌词',
        synced.map((record) => formatLyricsCandidate(record, probe.duration)),
        {defaultIndex: 0, enterLabel: synced.length === 1 ? '预览' : '预览第1个'},
      );
      if (choice === null) return false;
      if (choice === PICK_BACK) break;
      const picked = synced[choice.index];

      const preferred = await preferSimplifiedChineseLrc(picked.syncedLyrics);
      if (preferred.converted) term.info('中文歌词已转为简体,以下为最终保存预览');
      const entries = parseLrc(preferred.lyrics);
      let previewBack = false;
      for (let offset = 0; offset < entries.length; offset += PREVIEW_LINES) {
        term.info(formatLrcPageTitle(entries.length, offset));
        for (const line of formatLrcPreview(entries, {offset})) out.write(`${line}\n`);
        if (offset + PREVIEW_LINES >= entries.length) break;
        const action = await ask.line('翻看歌词', {
          legend: ['回车 下一页', 's 保存', '0 返回候选'],
        });
        if (action === '0') {
          previewBack = true;
          break;
        }
        if (action.toLowerCase() === 's') break;
      }
      if (previewBack) continue;

      const lrcName = `${path.basename(audio, path.extname(audio))}.lrc`;
      const relativeLrc = path.posix.join(AUDIO_DIR, lrcName);
      if (!(await ask.confirm(`歌词正确并保存为 ${relativeLrc}?`, {
        defaultLabel: '保存', alternateKey: 'r', alternateLabel: '返回候选',
      }))) continue;

      const installed = installDownloadedLyrics({
        lyrics: preferred.lyrics,
        folder,
        filename: lrcName,
        existing: existingLrc,
        task,
      });
      term.success(`歌词已保存: ${installed}`);
      term.detail(`可运行 node cli/kiseki.mjs lyrics ${folder} 预览完整对轴效果`);
      return true;
    }
  }
};

const resolveFolder = (folderArg) => {
  const folder = path.resolve(folderArg);
  if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) {
    throw new CliError(`不是文件夹: ${folder}`);
  }
  return folder;
};

export const buildNextStepMessage = (folder, {photos, audios}) => {
  if (photos.length === 0) return '下一步:先把照片放入素材夹';
  if (audios.length === 1) {
    return `下一步:可运行 ${formatEquivalentCommand([folder])} 渲染`;
  }
  return null;
};

export const chooseSingleAudio = async (ask, folder, audios) => {
  const choice = await ask.pick('文件夹里有多个音频,选择要保留的一个', audios, {
    allowBack: false,
  });
  if (choice === null || choice === PICK_BACK) {
    term.warn('未选择保留项,请手动清理到一个音频;未改动任何文件');
    return audios;
  }
  const keep = audios[choice.index];
  const remove = audios.filter((audio) => audio !== keep);
  if (!(await ask.confirm(`保留 ${keep},删除其余 ${remove.length} 个音频?`, {
    defaultValue: false, defaultLabel: '取消', alternateKey: 'd', alternateLabel: '删除',
  }))) {
    term.warn('已取消删除,请手动清理到一个音频;未改动任何文件');
    return audios;
  }
  for (const audio of remove) fs.rmSync(path.join(folder, audio));
  term.success(`已保留唯一音频: ${keep}`);
  return [keep];
};

/** `kiseki fetch <folder>`:显式备料入口,任何状态可进,覆盖需确认. */
export const runFetch = async (
  folderArg,
  {input = process.stdin, output = process.stdout, leaseManager = createTaskLeaseManager(), runtime = sourceRuntimeLayout} = {},
) => {
  if (input === process.stdin && (!process.stdin.isTTY || !process.stdout.isTTY)) {
    throw new CliError('fetch 是交互命令,需要在交互终端中运行');
  }
  const candidateFolder = path.resolve(folderArg);
  const inheritedTask = [
    'KISEKI_LEASE_TASK_ID',
    'KISEKI_LEASE_TASK_TOKEN',
    'KISEKI_LEASE_TASK_ROOT',
  ].some((key) => process.env[key] !== undefined)
    ? acquireCommandLease({kind: 'fetch', folder: candidateFolder, manager: leaseManager})
    : null;
  const folder = resolveFolder(folderArg);
  const task = inheritedTask ?? acquireCommandLease({kind: 'fetch', folder, manager: leaseManager});
  const originalEnv = Object.fromEntries(
    [...Object.keys(task.env), 'TMPDIR', 'TMP', 'TEMP'].map((key) => [key, process.env[key]]),
  );
  Object.assign(process.env, task.env);
  let succeeded = false;
  try {
  await withPrompts(async (ask) => {
    let {audios, lyrics} = scanFolderLoose(folder);
    let downloadedInfo = null;
    term.info(
      `当前素材 — 音频: ${audios[0] ?? '无'}${audios.length > 1 ? `(共 ${audios.length} 个,渲染前需清理到一个)` : ''} · 歌词: ${lyrics[0] ?? '无'}`,
    );

    if (audios.length > 1) {
      audios = await chooseSingleAudio(ask, folder, audios);
    } else if (audios.length === 1) {
      if (await ask.confirm(`已有 ${audios[0]},重新下载并替换?`, {
        defaultValue: false, defaultLabel: '保留', alternateKey: 'r', alternateLabel: '重新下载',
      })) {
        downloadedInfo = await audioFlow(ask, folder, {existing: audios[0], task, runtime});
        if (downloadedInfo && lyrics.length > 0) {
          term.warn('音频已更换,现有 .lrc 时间轴可能不再匹配,建议重新搜索歌词');
        }
      }
    } else if (await ask.confirm('文件夹里没有音频,现在下载?', {
      // 显式 fetch 入口默认执行主路径;自动兜底 offerFetch 仍默认跳过(有意不对称)
      defaultValue: true, defaultLabel: '下载', alternateKey: 's', alternateLabel: '跳过',
    })) {
      downloadedInfo = await audioFlow(ask, folder, {task, runtime});
    }

    ({audios, lyrics} = scanFolderLoose(folder));
    if (audios.length !== 1) {
      term.info('没有唯一音频,歌词需按时长匹配,跳过歌词搜索');
      return;
    }
    if (lyrics.length > 0) {
      if (await ask.confirm(`已有 ${lyrics[0]},重新搜索并替换?`, {
        defaultValue: false, defaultLabel: '保留', alternateKey: 'r', alternateLabel: '重新搜索',
      })) {
        await lyricsFlow(ask, output, folder, audios[0], {
          existingLrc: lyrics[0],
          confirmedTitle: downloadedInfo?.title,
          confirmedArtist: downloadedInfo?.artist,
          task,
          runtime,
        });
      }
    } else if (await ask.confirm('没有 .lrc,在线搜索同步歌词?', {
      defaultValue: true, defaultLabel: '搜索', alternateKey: 's', alternateLabel: '跳过',
    })) {
      const saved = await lyricsFlow(ask, output, folder, audios[0], {
        confirmedTitle: downloadedInfo?.title,
        confirmedArtist: downloadedInfo?.artist,
        task,
        runtime,
      });
      if (!saved) term.info('未保存歌词;渲染时会在本机识别人声并生成字幕,不会上传音频');
    }
    const nextStep = buildNextStepMessage(folder, scanFolderLoose(folder));
    if (nextStep) term.info(nextStep);
  }, {input, output});
  succeeded = true;
  return 0;
  } finally {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    if (!task.inherited && !task.manager.release(task.lease) && succeeded) throw new Error('任务 lease 释放失败');
  }
};

/**
 * 渲染 / lyrics 主流程兜底:交互终端下缺什么补什么,备齐则一句话不问.
 * 用户拒绝或失败后直接返回,由随后的 scanFolder 给出既有的清晰报错.
 */
export const offerFetch = async (folder, {input = process.stdin, output = process.stdout, task: existingTask = null, runtime = sourceRuntimeLayout} = {}) => {
  if (input === process.stdin && (!process.stdin.isTTY || !process.stdout.isTTY)) return;
  // Render's web child authenticates before scanning the project. A direct
  // interactive invocation keeps the short fetch lease lazy when nothing is
  // missing.
  const manager = existingTask?.manager ?? createTaskLeaseManager();
  const inherited = existingTask ? null : [
    'KISEKI_LEASE_TASK_ID',
    'KISEKI_LEASE_TASK_TOKEN',
    'KISEKI_LEASE_TASK_ROOT',
  ].some((key) => process.env[key] !== undefined)
    ? manager.attachInheritedLease({
      expectedFolder: folder,
      allowedParentKinds: ['render'],
    })
    : null;
  const {offerAudio, offerLyrics} = planOffers(scanFolderLoose(folder));
  if (!offerAudio && !offerLyrics) return;
  const task = existingTask ?? (inherited
    ? {
      lease: inherited,
      manager,
      inherited: true,
      env: {
        KISEKI_LEASE_TASK_ID: inherited.id,
        KISEKI_LEASE_TASK_TOKEN: inherited.token,
        KISEKI_LEASE_TASK_ROOT: inherited.taskRoot,
        TMPDIR: path.join(inherited.taskRoot, 'tmp'),
        TMP: path.join(inherited.taskRoot, 'tmp'),
        TEMP: path.join(inherited.taskRoot, 'tmp'),
      },
    }
    : acquireCommandLease({kind: 'fetch', folder, manager}));
  const originalEnv = Object.fromEntries(
    [...Object.keys(task.env), 'TMPDIR', 'TMP', 'TEMP'].map((key) => [key, process.env[key]]),
  );
  Object.assign(process.env, task.env);
  let succeeded = false;
  try {
  await withPrompts(async (ask) => {
    let downloadedInfo = null;
    if (offerAudio) {
      term.info('文件夹里没有音频');
      if (!(await ask.confirm('用 yt-dlp 搜索下载一个?', {
        defaultValue: false, defaultLabel: '跳过', alternateKey: 'd', alternateLabel: '下载',
      }))) {
        term.info(`之后可运行 ${formatEquivalentCommand(['fetch', folder])} 补齐`);
        return;
      }
      downloadedInfo = await audioFlow(ask, folder, {task, runtime});
      if (!downloadedInfo) return;
    }
    const {audios, lyrics} = scanFolderLoose(folder);
    if (audios.length === 1 && lyrics.length === 0) {
      term.detail('没有歌词也能继续;渲染时会在本机识别人声并生成字幕,不会上传音频');
      if (await ask.confirm('没有 .lrc,先在线搜索同步歌词吗?', {
        defaultValue: false, defaultLabel: '跳过', alternateKey: 's', alternateLabel: '搜索',
      })) {
        const saved = await lyricsFlow(ask, output, folder, audios[0], {
          confirmedTitle: downloadedInfo?.title,
          confirmedArtist: downloadedInfo?.artist,
          task,
          runtime,
        });
        if (!saved) term.info('未保存歌词;后续渲染会在本机识别人声并生成字幕');
      }
    }
  }, {input, output});
  succeeded = true;
  } finally {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    if (!existingTask && !task.inherited && !manager.release(task.lease) && succeeded) throw new Error('任务 lease 释放失败');
  }
};
