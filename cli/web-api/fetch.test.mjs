import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {PassThrough} from 'node:stream';
import test from 'node:test';

import {AUDIO_DIR} from '../project.mjs';
import {
  checkYtDlpAsync,
  runProcess,
  saveLyrics,
  searchAudioCandidates,
  searchLyricsCandidates,
  searchYtDlpAsync,
} from './fetch.mjs';

const makeTempRoot = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tsuzuri-web-fetch-'));

/** 造一个"有唯一音频"的素材夹,免得端点在前置检查就返回 400。 */
const makeFolderWithAudio = (root, name = 'trip') => {
  const folder = path.join(root, name);
  fs.mkdirSync(folder);
  fs.writeFileSync(path.join(folder, 'Song - Artist.m4a'), '');
  return folder;
};

/** 把预设的进程结果按命令分发,单测一律不真的联网/不真的起进程。 */
const fakeRun = (byCommand) => async (command) =>
  byCommand[command] ?? {status: null, stdout: '', stderr: ''};

const SYNCED_RECORD = {
  id: 42,
  trackName: 'Song',
  artistName: 'Artist',
  duration: 180,
  syncedLyrics: '[00:01.00]hello\n',
};

// ---- runProcess:异步封装本身 ----------------------------------------------

test('runProcess 收集 stdout 并回传退出码', async () => {
  const result = await runProcess(process.execPath, ['-e', 'process.stdout.write("hi")']);
  assert.equal(result.status, 0);
  assert.equal(result.stdout, 'hi');
});

test('runProcess 把"命令不存在"归一成 status null,而不是抛错', async () => {
  const result = await runProcess('tsuzuri-definitely-not-a-command', []);
  assert.equal(result.status, null);
});

test('runProcess 超时会杀掉子进程并返回 status null(不能让请求永远挂着)', async () => {
  const result = await runProcess(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], {timeout: 200});
  assert.equal(result.status, null);
});

test('runProcess 只解析一次结果(超时与退出竞争时不会重复 resolve)', async () => {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => {};
  const promise = runProcess('x', [], {timeout: 50, spawnImpl: () => child});
  child.emit('close', 0);
  child.emit('close', 1);
  assert.equal((await promise).status, 0);
});

// ---- 复用 cli/ 的解析逻辑 ---------------------------------------------------

test('checkYtDlpAsync 复用 checkYtDlp 的判定', async () => {
  const ok = await checkYtDlpAsync(fakeRun({'yt-dlp': {status: 0, stdout: '2026.01.01\n', stderr: ''}}));
  assert.deepEqual(ok, {ok: true, version: '2026.01.01'});
  const missing = await checkYtDlpAsync(fakeRun({}));
  assert.deepEqual(missing, {ok: false});
});

test('searchYtDlpAsync 复用 parseSearchLine,跳过畸形行', async () => {
  const run = fakeRun({
    'yt-dlp': {status: 0, stdout: 'abc123\tSong\t3:01\tChannel\n\ngarbage-no-tab\n', stderr: ''},
  });
  const result = await searchYtDlpAsync('song', run);
  assert.deepEqual(result.candidates, [
    {id: 'abc123', title: 'Song', duration: '3:01', uploader: 'Channel'},
  ]);
});

// ---- GET /api/fetch/lyrics-search ------------------------------------------

test('lyrics-search:folder 越界 → 403', async () => {
  const root = makeTempRoot();
  const result = await searchLyricsCandidates(root, path.join(root, '..', '..'), {run: fakeRun({})});
  assert.equal(result.status, 403);
});

test('lyrics-search:folder 缺失 → 403(沙箱不接受空路径)', async () => {
  const root = makeTempRoot();
  const result = await searchLyricsCandidates(root, null, {run: fakeRun({})});
  assert.equal(result.status, 403);
});

test('lyrics-search:没有唯一音频 → 400', async () => {
  const root = makeTempRoot();
  const folder = path.join(root, 'empty');
  fs.mkdirSync(folder);
  const result = await searchLyricsCandidates(root, folder, {run: fakeRun({})});
  assert.equal(result.status, 400);
});

test('lyrics-search:候选按契约形状返回,查询词从文件名推出', async () => {
  const root = makeTempRoot();
  const folder = makeFolderWithAudio(root);
  const queries = [];
  const fetcher = async (pathname, params) => {
    queries.push([pathname, params]);
    return [SYNCED_RECORD, {id: 7, trackName: 'x', artistName: 'y', duration: 10, syncedLyrics: ''}];
  };
  const result = await searchLyricsCandidates(root, folder, {run: fakeRun({}), fetcher});
  assert.equal(result.status, 200);
  // ffprobe 取不到 tag(fakeRun 返回 status null),查询词回退到文件名
  assert.equal(result.body.query, 'Song Artist.m4a'.replace('.m4a', ''));
  assert.equal(result.body.candidates.length, 1, '无时间轴的候选必须被 filterSyncedRecords 滤掉');
  assert.deepEqual(result.body.candidates[0], {
    id: 42,
    title: 'Song',
    artist: 'Artist',
    duration: 180,
    delta: null,
    synced: true,
  });
  assert.deepEqual(queries[0][0], '/search');
});

test('lyrics-search:LRCLIB 出错 → 502 且带上原因', async () => {
  const root = makeTempRoot();
  const folder = makeFolderWithAudio(root);
  const fetcher = async () => {
    throw new Error('请求失败');
  };
  const result = await searchLyricsCandidates(root, folder, {run: fakeRun({}), fetcher});
  assert.equal(result.status, 502);
  assert.match(result.body.error, /请求失败/);
});

// ---- POST /api/fetch/lyrics ------------------------------------------------

test('lyrics:folder 越界 → 403', async () => {
  const root = makeTempRoot();
  const result = await saveLyrics(root, {folder: path.join(root, '..'), id: 1}, {run: fakeRun({})});
  assert.equal(result.status, 403);
});

test('lyrics:非法 id → 400', async () => {
  const root = makeTempRoot();
  const folder = makeFolderWithAudio(root);
  for (const id of ['../etc', {}, '1; rm -rf /', null]) {
    const result = await saveLyrics(root, {folder, id}, {run: fakeRun({})});
    assert.equal(result.status, 400, `id=${JSON.stringify(id)} 应当被拒绝`);
  }
});

test('lyrics:落盘到 audio/,文件名跟随音频名', async () => {
  const root = makeTempRoot();
  const folder = makeFolderWithAudio(root);
  const fetcher = async (pathname) => {
    assert.equal(pathname, '/get/42');
    return SYNCED_RECORD;
  };
  const result = await saveLyrics(root, {folder, id: 42}, {run: fakeRun({}), fetcher});
  assert.equal(result.status, 200);
  assert.equal(result.body.file, path.posix.join(AUDIO_DIR, 'Song - Artist.lrc'));
  assert.ok(fs.existsSync(path.join(folder, AUDIO_DIR, 'Song - Artist.lrc')));
});

test('lyrics:记录没有同步歌词 → 404', async () => {
  const root = makeTempRoot();
  const folder = makeFolderWithAudio(root);
  const fetcher = async () => ({...SYNCED_RECORD, syncedLyrics: ''});
  const result = await saveLyrics(root, {folder, id: 42}, {run: fakeRun({}), fetcher});
  assert.equal(result.status, 404);
});

// ---- GET /api/fetch/audio-search -------------------------------------------

test('audio-search:缺 yt-dlp → 503 并带安装提示', async () => {
  const result = await searchAudioCandidates('song', {run: fakeRun({})});
  assert.equal(result.status, 503);
  assert.match(result.body.fix, /yt-dlp/);
});

test('audio-search:空关键词 → 400,且不会去起 yt-dlp', async () => {
  let called = false;
  const run = async () => {
    called = true;
    return {status: 0, stdout: '', stderr: ''};
  };
  const result = await searchAudioCandidates('   ', {run});
  assert.equal(result.status, 400);
  assert.equal(called, false);
});

test('audio-search:正常返回候选', async () => {
  const run = async (command, args) => {
    if (args[0] === '--version') return {status: 0, stdout: '2026.01.01', stderr: ''};
    return {status: 0, stdout: 'abc123\tSong\t3:01\tChannel\n', stderr: ''};
  };
  const result = await searchAudioCandidates('song', {run});
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.candidates, [
    {id: 'abc123', title: 'Song', duration: '3:01', uploader: 'Channel'},
  ]);
});

test('audio-search:yt-dlp 搜索失败 → 502', async () => {
  const run = async (command, args) => {
    if (args[0] === '--version') return {status: 0, stdout: '2026.01.01', stderr: ''};
    return {status: 1, stdout: '', stderr: 'ERROR: unable to download'};
  };
  const result = await searchAudioCandidates('song', {run});
  assert.equal(result.status, 502);
  assert.match(result.body.detail, /unable to download/);
});

test('lyrics-search:q 覆盖自动推断的查询词', async () => {
  // 文件名乱七八糟时自动推断必然猜错,重新输关键词是唯一的补救路径
  const root = makeTempRoot();
  const folder = makeFolderWithAudio(root);
  const queries = [];
  const fetcher = async (pathname, params) => {
    queries.push([pathname, params]);
    return [];
  };
  const result = await searchLyricsCandidates(root, folder, {
    run: fakeRun({}),
    fetcher,
    query: '  Yellow Coldplay  ',
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.query, 'Yellow Coldplay', '前后空白要去掉');
});

test('lyrics-search:空白的 q 退回自动推断', async () => {
  const root = makeTempRoot();
  const folder = makeFolderWithAudio(root);
  const result = await searchLyricsCandidates(root, folder, {
    run: fakeRun({}),
    fetcher: async () => [],
    query: '   ',
  });
  assert.equal(result.body.query, 'Song Artist');
});

test('lyrics-search:tag 齐全时,手输关键词必须走 /search 而不是 /get 精确查询', async () => {
  // 这是 q 唯一真正要解决的场景:tag 齐全但写错了(标题是专辑名/翻唱版本),
  // 不把 customized 传下去的话 searchLyricsRecords 会先打 /get 命中并直接返回,
  // 用户改多少次关键词都拿到同一批错结果。
  const root = makeTempRoot();
  const folder = makeFolderWithAudio(root);
  const tagged = fakeRun({
    ffprobe: {
      status: 0,
      stdout: JSON.stringify({format: {duration: '180', tags: {title: 'Wrong Title', artist: 'Wrong Artist'}}}),
      stderr: '',
    },
  });
  const paths = [];
  const fetcher = async (pathname) => {
    paths.push(pathname);
    return pathname === '/get' ? SYNCED_RECORD : [SYNCED_RECORD];
  };

  await searchLyricsCandidates(root, folder, {run: tagged, fetcher, query: 'Yellow Coldplay'});
  assert.deepEqual(paths, ['/search'], '手输关键词时不该再走 /get');

  paths.length = 0;
  await searchLyricsCandidates(root, folder, {run: tagged, fetcher});
  assert.equal(paths[0], '/get', '没有手输关键词时仍应先试精确查询');
});
