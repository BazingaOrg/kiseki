import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {PassThrough} from 'node:stream';
import test from 'node:test';

import {AUDIO_DIR} from '../project.mjs';
import {createTaskLeaseManager} from '../task-lease.mjs';
import {
  checkYtDlpAsync,
  runProcess,
  saveLyrics,
  searchAudioCandidates,
  searchLyricsCandidates,
  searchYtDlpAsync,
} from './fetch.mjs';

const makeTempRoot = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tsuzuri-web-fetch-'));
const saveLyricsWithIsolatedLease = (root, body, options) => saveLyrics(root, body, {
  ...options,
  leaseManager: createTaskLeaseManager({registryRoot: path.join(root, '.runtime')}),
});

/** 造一个"有唯一音频"的素材夹,免得端点在前置检查就返回 400. */
const makeFolderWithAudio = (root, name = 'trip') => {
  const folder = path.join(root, name);
  fs.mkdirSync(folder);
  fs.writeFileSync(path.join(folder, 'Song - Artist.m4a'), '');
  return folder;
};

/** 把预设的进程结果按命令分发,单测一律不真的联网/不真的起进程. */
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

test('searchYtDlpAsync 复用解析逻辑,稳定去重后限制候选', async () => {
  const lines = Array.from({length: 12}, (_, index) =>
    `${index === 3 ? '2' : index}\tSong ${index}\t3:01\tChannel`,
  );
  const run = fakeRun({
    'yt-dlp': {status: 0, stdout: `${lines.join('\n')}\n\ngarbage-no-tab\n`, stderr: ''},
  });
  const result = await searchYtDlpAsync('song', run);
  assert.deepEqual(result.candidates.map(({id}) => id), ['0', '1', '2', '4', '5', '6', '7', '8', '9', '10']);
});

test('searchYtDlpAsync normalizes whitespace and asks the provider for 20', async () => {
  let args;
  await searchYtDlpAsync('  晴天   + 周杰伦  ', async (_command, received) => {
    args = received;
    return {status: 0, stdout: '', stderr: ''};
  });
  assert.equal(args[0], 'ytsearch20:晴天 + 周杰伦');
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
    id: '42',
    title: 'Song',
    artist: 'Artist',
    duration: 180,
    delta: null,
    synced: true,
  });
  assert.deepEqual(queries[0][0], '/search');
});

test('lyrics-search:过滤后稳定按 id 去重并限制候选', async () => {
  const root = makeTempRoot();
  const folder = makeFolderWithAudio(root);
  const records = Array.from({length: 12}, (_, index) => ({
    ...SYNCED_RECORD,
    id: index === 3 ? 2 : index,
    trackName: `Song ${index}`,
  }));
  const result = await searchLyricsCandidates(root, folder, {run: fakeRun({}), fetcher: async () => records});
  assert.deepEqual(result.body.candidates.map(({id}) => id), ['0', '1', '2', '4', '5', '6', '7', '8', '9', '10']);
});

test('lyrics-search:筛掉前十中的无效、纯文本和器乐记录后仍从后续有效记录补满十条', async () => {
  const root = makeTempRoot();
  const folder = makeFolderWithAudio(root);
  const rejected = Array.from({length: 10}, (_, index) => ({
    ...SYNCED_RECORD,
    id: index % 3 === 0 ? undefined : index,
    instrumental: index % 3 === 1,
    syncedLyrics: index % 3 === 2 ? '' : SYNCED_RECORD.syncedLyrics,
  }));
  const valid = Array.from({length: 10}, (_, index) => ({...SYNCED_RECORD, id: index + 100}));
  const result = await searchLyricsCandidates(root, folder, {run: fakeRun({}), fetcher: async () => [...rejected, ...valid]});
  assert.deepEqual(result.body.candidates.map(({id}) => id), valid.map(({id}) => String(id)));
});

test('lyrics-search:Web 候选过滤缺失 id,并以 canonical id 下发', async () => {
  const root = makeTempRoot();
  const folder = makeFolderWithAudio(root);
  const records = [
    {...SYNCED_RECORD, id: 42},
    {...SYNCED_RECORD, id: '42'},
    {...SYNCED_RECORD, id: undefined, trackName: 'no id'},
  ];
  const result = await searchLyricsCandidates(root, folder, {run: fakeRun({}), fetcher: async () => records});
  assert.deepEqual(result.body.candidates.map(({id}) => id), ['42']);
});

test('lyrics-search:comparable local durations sort by delta while missing durations stay last', async () => {
  const root = makeTempRoot();
  const folder = makeFolderWithAudio(root);
  const run = fakeRun({
    ffprobe: {status: 0, stdout: JSON.stringify({format: {duration: '180'}}), stderr: ''},
  });
  const records = [
    {...SYNCED_RECORD, id: 1, duration: 200},
    {...SYNCED_RECORD, id: 2, duration: 181},
    {...SYNCED_RECORD, id: 3, duration: null},
    {...SYNCED_RECORD, id: 4, duration: 179},
  ];
  const result = await searchLyricsCandidates(root, folder, {run, fetcher: async () => records, query: 'manual'});
  assert.deepEqual(result.body.candidates.map(({id}) => id), ['2', '4', '1', '3']);
});

test('lyrics-search:equal duration deltas retain provider order, and missing local duration does not reorder', async () => {
  const root = makeTempRoot();
  const folder = makeFolderWithAudio(root);
  const records = [
    {...SYNCED_RECORD, id: 1, duration: 182},
    {...SYNCED_RECORD, id: 2, duration: 178},
    {...SYNCED_RECORD, id: 3, duration: null},
  ];
  const durationRun = fakeRun({ffprobe: {status: 0, stdout: JSON.stringify({format: {duration: '180'}}), stderr: ''}});
  const matched = await searchLyricsCandidates(root, folder, {run: durationRun, fetcher: async () => records, query: 'manual'});
  assert.deepEqual(matched.body.candidates.map(({id}) => id), ['1', '2', '3']);

  const unknown = await searchLyricsCandidates(root, folder, {run: fakeRun({}), fetcher: async () => records, query: 'manual'});
  assert.deepEqual(unknown.body.candidates.map(({id}) => id), ['1', '2', '3']);
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
  const result = await saveLyricsWithIsolatedLease(root, {folder: path.join(root, '..'), id: 1}, {run: fakeRun({})});
  assert.equal(result.status, 403);
});

test('lyrics:非法 id → 400', async () => {
  const root = makeTempRoot();
  const folder = makeFolderWithAudio(root);
  for (const id of ['../etc', 'abc', '1.2', -1, 1.2, Number.MAX_SAFE_INTEGER + 1, {}, '1; rm -rf /', null]) {
    const result = await saveLyricsWithIsolatedLease(root, {folder, id}, {run: fakeRun({})});
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
  const result = await saveLyricsWithIsolatedLease(root, {folder, id: 42}, {run: fakeRun({}), fetcher});
  assert.equal(result.status, 200);
  assert.equal(result.body.file, path.posix.join(AUDIO_DIR, 'Song - Artist.lrc'));
  assert.ok(fs.existsSync(path.join(folder, AUDIO_DIR, 'Song - Artist.lrc')));
});

test('lyrics:root 路径含符号链接时仍能保存(回归:TOCTOU 复查曾把外层已展开符号链接的 folder 再喂回 resolveAudioFolder,导致它与未展开的 root 做前缀比对时误判越界,错误返回 403)', async () => {
  const base = makeTempRoot();
  const realRoot = path.join(base, 'real');
  fs.mkdirSync(realRoot);
  const linkRoot = path.join(base, 'link');
  fs.symlinkSync(realRoot, linkRoot);
  const folder = makeFolderWithAudio(linkRoot);
  const fetcher = async (pathname) => {
    assert.equal(pathname, '/get/42');
    return SYNCED_RECORD;
  };
  const result = await saveLyricsWithIsolatedLease(linkRoot, {folder, id: 42}, {run: fakeRun({}), fetcher});
  assert.equal(result.status, 200);
  assert.equal(result.body.file, path.posix.join(AUDIO_DIR, 'Song - Artist.lrc'));
  assert.ok(fs.existsSync(path.join(folder, AUDIO_DIR, 'Song - Artist.lrc')));
});

test('lyrics:记录没有同步歌词 → 404', async () => {
  const root = makeTempRoot();
  const folder = makeFolderWithAudio(root);
  const fetcher = async () => ({...SYNCED_RECORD, syncedLyrics: ''});
  const result = await saveLyricsWithIsolatedLease(root, {folder, id: 42}, {run: fakeRun({}), fetcher});
  assert.equal(result.status, 404);
});

test('lyrics:LRCLIB 返回的 id 与请求不一致 → 502', async () => {
  const root = makeTempRoot();
  const folder = makeFolderWithAudio(root);
  const result = await saveLyricsWithIsolatedLease(root, {folder, id: 42}, {
    run: fakeRun({}),
    fetcher: async () => ({...SYNCED_RECORD, id: 7}),
  });
  assert.equal(result.status, 502);
  assert.match(result.body.error, /id 与请求不一致/);
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

test('lyrics-search:手输关键词折叠内部空白后传给 LRCLIB', async () => {
  const root = makeTempRoot();
  const folder = makeFolderWithAudio(root);
  const calls = [];
  await searchLyricsCandidates(root, folder, {
    run: fakeRun({}),
    query: '  Yellow   + Coldplay · live  ',
    fetcher: async (pathname, params) => {
      calls.push({pathname, params});
      return [];
    },
  });
  assert.deepEqual(calls, [{pathname: '/search', params: {q: 'Yellow + Coldplay · live'}}]);
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
  // 用户改多少次关键词都拿到同一批错结果.
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

test('lyrics-search:tag 齐全时 /get 的传输或协议错误直接报错,不能回退 /search', async () => {
  const root = makeTempRoot();
  const folder = makeFolderWithAudio(root);
  const tagged = fakeRun({
    ffprobe: {
      status: 0,
      stdout: JSON.stringify({format: {duration: '180', tags: {title: 'Song', artist: 'Artist'}}}),
      stderr: '',
    },
  });
  for (const error of [new Error('connect ECONNREFUSED'), new SyntaxError('Unexpected token')]) {
    const paths = [];
    const result = await searchLyricsCandidates(root, folder, {
      run: tagged,
      fetcher: async (pathname) => {
        paths.push(pathname);
        throw error;
      },
    });
    assert.equal(result.status, 502);
    assert.match(result.body.error, new RegExp(error.message));
    assert.deepEqual(paths, ['/get']);
  }
});
