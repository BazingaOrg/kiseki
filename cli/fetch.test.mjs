import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {PassThrough} from 'node:stream';
import test from 'node:test';

import {PICK_BACK} from './prompts.mjs';
import {term} from './term.mjs';
import {createTaskLeaseManager} from './task-lease.mjs';

import {
  buildAudioFilename,
  buildLyricsQuery,
  buildNextStepMessage,
  canonicalLyricsId,
  chooseSingleAudio,
  durationDelta,
  filterSyncedRecords,
  formatDuration,
  formatLyricsCandidate,
  installDownloadedAudio,
  limitLyricsCandidates,
  installDownloadedLyrics,
  lyricsFlow,
  parseCurlResponse,
  planOffers,
  probeAudio,
  runFetch,
  sanitizeFilePart,
  searchLyricsRecords,
} from './fetch.mjs';

const originalTermTask = term.task;
term.task = () => ({succeed() {}, fail() {}, endLine() {}});
test.after(() => {
  term.task = originalTermTask;
});

const runFetchWithAnswers = async (folder, answers) => {
  const leaseManager = createTaskLeaseManager({registryRoot: path.join(folder, '.runtime')});
  const input = new PassThrough();
  const output = new PassThrough();
  let text = '';
  output.setEncoding('utf8');
  output.on('data', (chunk) => { text += chunk; });
  // 静音 term 的状态输出:异步写 process.stdout 会与 node:test 的报告流交错
  const silenced = ['info', 'start', 'success', 'warn', 'error', 'detail'];
  const originals = Object.fromEntries(silenced.map((k) => [k, term[k]]));
  originals.task = term.task;
  for (const k of silenced) term[k] = () => {};
  term.task = () => ({succeed() {}, fail() {}, endLine() {}});
  try {
    const pending = runFetch(folder, {input, output, leaseManager});
    for (const answer of answers) {
      input.write(`${answer}\n`);
      await new Promise((resolve) => setImmediate(resolve));
    }
    const code = await pending;
    input.end();
    return {code, output: text};
  } finally {
    Object.assign(term, originals);
  }
};

test('buildLyricsQuery prefers tags and falls back to a cleaned filename', () => {
  assert.equal(buildLyricsQuery({title: '晴天', artist: '周杰伦'}), '晴天 周杰伦');
  assert.equal(buildLyricsQuery({title: '晴天', artist: null}), '晴天');
  assert.equal(buildLyricsQuery({audioFile: 'jay_chou-qing.tian.mp3'}), 'jay chou qing tian');
  assert.equal(buildLyricsQuery({audioFile: '晴天 - 周杰伦.m4a'}), '晴天 周杰伦');
});

test('durationDelta compares only when both durations are known', () => {
  assert.equal(durationDelta(269, 272), 3);
  assert.equal(durationDelta(null, 272), null);
  assert.equal(durationDelta(269, undefined), null);
});

test('formatLyricsCandidate warns when the duration gap exceeds the threshold', () => {
  const record = {trackName: '晴天', artistName: '周杰伦', duration: 269};
  assert.equal(formatLyricsCandidate(record, 269), '晴天 - 周杰伦 (4:29)');
  assert.match(formatLyricsCandidate(record, 281), /⚠ 与音频时长差 12s/);
  assert.equal(formatLyricsCandidate(record, null), '晴天 - 周杰伦 (4:29)');
});

test('filterSyncedRecords drops instrumental and lyrics without a timeline', () => {
  const synced = {syncedLyrics: '[00:01.00] hi', instrumental: false};
  assert.deepEqual(
    filterSyncedRecords([synced, {syncedLyrics: null}, {syncedLyrics: '  '}, {syncedLyrics: '[0:1]x', instrumental: true}, null]),
    [synced],
  );
  assert.deepEqual(filterSyncedRecords(null), []);
});

test('limitLyricsCandidates 稳定按 id 去重后限制为 10 个候选', () => {
  const records = Array.from({length: 12}, (_, index) => ({
    id: index === 3 ? 2 : index,
    syncedLyrics: '[00:01.00]ok',
  }));
  assert.deepEqual(limitLyricsCandidates(records).map(({id}) => id), [0, 1, 2, 4, 5, 6, 7, 8, 9, 10]);
});

test('LRCLIB id 用 String(id) 去重,缺失 id 的候选彼此保留', () => {
  const records = [
    {id: 42, syncedLyrics: '[00:01.00]a'},
    {id: '42', syncedLyrics: '[00:01.00]b'},
    {syncedLyrics: '[00:01.00]c'},
    {syncedLyrics: '[00:01.00]d'},
  ];
  assert.equal(canonicalLyricsId(42), '42');
  assert.equal(canonicalLyricsId(''), null);
  assert.equal(canonicalLyricsId('abc'), null);
  assert.equal(canonicalLyricsId('1.2'), null);
  assert.equal(canonicalLyricsId(-1), null);
  assert.equal(canonicalLyricsId(1.2), null);
  assert.equal(canonicalLyricsId(Number.MAX_SAFE_INTEGER + 1), null);
  assert.equal(canonicalLyricsId(undefined), null);
  assert.deepEqual(limitLyricsCandidates(records), [records[0], records[2], records[3]]);
});

test('formatDuration renders m:ss and tolerates unknown values', () => {
  assert.equal(formatDuration(269), '4:29');
  assert.equal(formatDuration(60), '1:00');
  assert.equal(formatDuration(59.6), '1:00');
  assert.equal(formatDuration(119.6), '2:00');
  assert.equal(formatDuration(null), '?:??');
});

test('downloaded audio names use confirmed song metadata and remove unsafe characters', () => {
  assert.equal(sanitizeFilePart('  A/B: Song?  '), 'A B Song');
  assert.equal(
    buildAudioFilename({title: 'The Winner Is', artist: 'DeVotchKa / Mychael Danna', ext: '.M4A'}),
    'The Winner Is - DeVotchKa Mychael Danna.m4a',
  );
  assert.equal(buildAudioFilename({title: '晴天', artist: '', ext: 'mp3'}), '晴天.mp3');
  assert.throws(() => buildAudioFilename({title: ' / ', artist: '', ext: 'mp3'}), /歌曲名不能为空/);
});

test('LRCLIB falls back to search when an exact record has no synced lyrics', async () => {
  const calls = [];
  const searchResult = [{syncedLyrics: '[00:01]ok'}];
  const fetcher = async (pathname, params) => {
    calls.push({pathname, params});
    return pathname === '/get' ? {plainLyrics: 'text only'} : searchResult;
  };
  const result = await searchLyricsRecords(
    {query: 'Song Artist', title: 'Song', artist: 'Artist', duration: 100},
    fetcher,
  );
  assert.deepEqual(result, searchResult);
  assert.deepEqual(calls.map((c) => c.pathname), ['/get', '/search']);
});

test('LRCLIB keeps a usable exact synced record with id without searching again', async () => {
  const calls = [];
  const exact = {id: 42, syncedLyrics: '[00:01]ok', instrumental: false};
  const result = await searchLyricsRecords(
    {query: 'Song Artist', title: 'Song', artist: 'Artist', duration: 100},
    async (pathname) => {
      calls.push(pathname);
      return exact;
    },
  );
  assert.deepEqual(result, [exact]);
  assert.deepEqual(calls, ['/get']);
});

test('CLI keeps a synced exact record without a provider id', async () => {
  const calls = [];
  const exact = {syncedLyrics: '[00:01]ok'};
  const result = await searchLyricsRecords(
    {query: 'Song Artist', title: 'Song', artist: 'Artist', duration: 100},
    async (pathname) => {
      calls.push(pathname);
      return exact;
    },
  );
  assert.deepEqual(result, [exact]);
  assert.deepEqual(calls, ['/get']);
});

test('Web mode falls back when an exact synced record has no id', async () => {
  const calls = [];
  const searchResult = [{id: 7, syncedLyrics: '[00:01]ok'}];
  const result = await searchLyricsRecords(
    {query: 'Song Artist', title: 'Song', artist: 'Artist', duration: 100, requireValidId: true},
    async (pathname) => {
      calls.push(pathname);
      return pathname === '/get' ? {syncedLyrics: '[00:01]ok'} : searchResult;
    },
  );
  assert.deepEqual(result, searchResult);
  assert.deepEqual(calls, ['/get', '/search']);
});

test('lyrics preview can return to candidates without repeating the network search', async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'kiseki-fetch-test-'));
  fs.writeFileSync(path.join(folder, 'song.wav'), Buffer.alloc(44));
  const syncedLyrics = Array.from({length: 13}, (_, i) =>
    `[00:${String(i).padStart(2, '0')}.00]行${i}`,
  ).join('\n');
  let fetchCount = 0;
  let pickCount = 0;
  const previewActions = ['0', 's'];
  try {
    const saved = await lyricsFlow({
      line: async (text) => text === '歌词搜索关键词' ? 'song' : previewActions.shift(),
      pick: async (_text, _items, options) => {
        pickCount += 1;
        assert.deepEqual(options, {defaultIndex: 0, enterLabel: '预览'});
        return {index: 0};
      },
      confirm: async () => true,
    }, {write: () => {}}, folder, 'song.wav', {
      fetcher: async () => {
        fetchCount += 1;
        return [{
          trackName: 'Song', artistName: 'Artist', duration: 13,
          syncedLyrics, instrumental: false,
        }];
      },
    });

    assert.equal(saved, true);
    assert.equal(fetchCount, 1);
    assert.equal(pickCount, 2);
    assert.equal(fs.readFileSync(path.join(folder, 'audio', 'song.lrc'), 'utf8'), syncedLyrics);
  } finally {
    fs.rmSync(folder, {recursive: true, force: true});
  }
});

test('multiple lyric candidates default to previewing the first on enter', async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'kiseki-fetch-test-'));
  fs.writeFileSync(path.join(folder, 'song.wav'), Buffer.alloc(44));
  const record = (name) => ({
    trackName: name, artistName: 'Artist', duration: 13,
    syncedLyrics: '[00:01.00]行', instrumental: false,
  });
  try {
    const saved = await lyricsFlow({
      line: async () => 'song',
      pick: async (_text, items, options) => {
        assert.equal(items.length, 2);
        assert.deepEqual(options, {defaultIndex: 0, enterLabel: '预览第1个'});
        return null;
      },
    }, {write: () => {}}, folder, 'song.wav', {
      fetcher: async () => [record('A'), record('B')],
    });
    assert.equal(saved, false);
  } finally {
    fs.rmSync(folder, {recursive: true, force: true});
  }
});

test('lyrics keyword prompt explains enter/back and returns before network access', async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'kiseki-fetch-test-'));
  fs.writeFileSync(path.join(folder, 'Yellow - Coldplay.wav'), Buffer.alloc(44));
  let fetchCount = 0;
  try {
    const saved = await lyricsFlow({
      line: async (text, options) => {
        assert.equal(text, '歌词搜索关键词');
        assert.equal(options.defaultValue, 'Yellow Coldplay');
        assert.equal(options.enterLabel, '搜索');
        assert.equal(options.allowBack, true);
        return PICK_BACK;
      },
    }, {write: () => {}}, folder, 'Yellow - Coldplay.wav', {
      fetcher: async () => {
        fetchCount += 1;
        return [];
      },
    });

    assert.equal(saved, false);
    assert.equal(fetchCount, 0);
  } finally {
    fs.rmSync(folder, {recursive: true, force: true});
  }
});

test('a failed staged install preserves the existing audio', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kiseki-fetch-test-'));
  const oldFile = path.join(root, 'Song.m4a');
  fs.writeFileSync(oldFile, 'old audio');
  try {
    assert.throws(() => installDownloadedAudio({
      source: path.join(root, 'missing.m4a'),
      folder: root,
      filename: 'Song.m4a',
      existing: 'Song.m4a',
    }));
    assert.equal(fs.readFileSync(oldFile, 'utf8'), 'old audio');
    assert.deepEqual(fs.readdirSync(root), ['Song.m4a']);
  } finally {
    fs.rmSync(root, {recursive: true, force: true});
  }
});

test('a failed staged lyrics replacement preserves the existing lyrics', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kiseki-fetch-test-'));
  const audioFolder = path.join(root, 'audio');
  fs.mkdirSync(audioFolder);
  const oldFile = path.join(audioFolder, 'Song.lrc');
  fs.writeFileSync(oldFile, 'old lyrics');
  try {
    assert.throws(() => installDownloadedLyrics({
      lyrics: Symbol('invalid contents'),
      folder: root,
      filename: 'Song.lrc',
      existing: 'audio/Song.lrc',
    }));
    assert.equal(fs.readFileSync(oldFile, 'utf8'), 'old lyrics');
    assert.deepEqual(fs.readdirSync(audioFolder), ['Song.lrc']);
  } finally {
    fs.rmSync(root, {recursive: true, force: true});
  }
});

test('planOffers only proposes what the folder is missing', () => {
  assert.deepEqual(planOffers({audios: [], lyrics: []}), {offerAudio: true, offerLyrics: false});
  assert.deepEqual(planOffers({audios: ['a.mp3'], lyrics: []}), {offerAudio: false, offerLyrics: true});
  assert.deepEqual(planOffers({audios: ['a.mp3'], lyrics: ['a.lrc']}), {offerAudio: false, offerLyrics: false});
  // 多个音频交给 scanFolder 的既有报错,不在兜底流程里处理
  assert.deepEqual(planOffers({audios: ['a.mp3', 'b.mp3'], lyrics: []}), {offerAudio: false, offerLyrics: false});
});

test('next-step guidance follows the final material state', () => {
  assert.equal(
    buildNextStepMessage('/my trip', {photos: ['a.jpg'], audios: ['song.m4a']}),
    "下一步:可运行 node cli/kiseki.mjs '/my trip' 渲染",
  );
  assert.equal(
    buildNextStepMessage('/trip', {photos: [], audios: ['song.m4a']}),
    '下一步:先把照片放入素材夹',
  );
  assert.equal(buildNextStepMessage('/trip', {photos: ['a.jpg'], audios: []}), null);
});

test('multiple-audio cleanup deletes only after explicit delete action', async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'kiseki-fetch-test-'));
  for (const name of ['a.mp3', 'b.m4a']) fs.writeFileSync(path.join(folder, name), name);
  try {
    const calls = [];
    const result = await chooseSingleAudio({
      pick: async (text, items, options) => {
        calls.push({text, items, options});
        return {index: 1, item: items[1]};
      },
      confirm: async (text, options) => {
        calls.push({text, options});
        return true;
      },
    }, folder, ['a.mp3', 'b.m4a']);
    assert.deepEqual(result, ['b.m4a']);
    assert.deepEqual(fs.readdirSync(folder), ['b.m4a']);
    assert.deepEqual(calls[0], {
      text: '文件夹里有多个音频,选择要保留的一个',
      items: ['a.mp3', 'b.m4a'],
      options: {allowBack: false},
    });
    assert.deepEqual(calls[1].options, {
      defaultValue: false,
      defaultLabel: '取消',
      alternateKey: 'd',
      alternateLabel: '删除',
    });
  } finally {
    fs.rmSync(folder, {recursive: true, force: true});
  }
});

test('multiple-audio cleanup abandon leaves files untouched', async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'kiseki-fetch-test-'));
  for (const name of ['a.mp3', 'b.m4a']) fs.writeFileSync(path.join(folder, name), name);
  try {
    const result = await chooseSingleAudio({pick: async () => null}, folder, ['a.mp3', 'b.m4a']);
    assert.deepEqual(result, ['a.mp3', 'b.m4a']);
    assert.deepEqual(fs.readdirSync(folder).sort(), ['a.mp3', 'b.m4a']);
  } finally {
    fs.rmSync(folder, {recursive: true, force: true});
  }
});

test('parseCurlResponse splits body from the trailing status code', () => {
  assert.deepEqual(parseCurlResponse('[{"id":1}]\n200'), {status: 200, body: '[{"id":1}]'});
  assert.deepEqual(parseCurlResponse('{"a":"多\n行"}\n404'), {status: 404, body: '{"a":"多\n行"}'});
  assert.equal(parseCurlResponse('no-status-line'), null);
  assert.equal(parseCurlResponse(''), null);
  assert.equal(parseCurlResponse('body\nabc'), null);
});

test('explicit fetch defaults to downloading when the folder has no audio', async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'kiseki-fetch-test-'));
  try {
    const {code, output} = await runFetchWithAnswers(folder, ['s']);
    assert.equal(code, 0);
    assert.match(output, /\? 文件夹里没有音频,现在下载\? · 回车 下载 · s 跳过: /);
  } finally {
    fs.rmSync(folder, {recursive: true, force: true});
  }
});

test('explicit fetch defaults to searching lyrics when audio exists without an .lrc', async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'kiseki-fetch-test-'));
  fs.writeFileSync(path.join(folder, 'song.wav'), Buffer.alloc(44));
  try {
    const {code, output} = await runFetchWithAnswers(folder, ['', 's']);
    assert.equal(code, 0);
    assert.match(output, /\? 已有 song\.wav,重新下载并替换\? · 回车 保留 · r 重新下载: /);
    assert.match(output, /\? 没有 \.lrc,在线搜索同步歌词\? · 回车 搜索 · s 跳过: /);
  } finally {
    fs.rmSync(folder, {recursive: true, force: true});
  }
});

test('probeAudio lowercases tag keys and swallows ffprobe failures', () => {
  const stdout = JSON.stringify({format: {duration: '269.4', tags: {TITLE: '晴天', Artist: '周杰伦'}}});
  assert.deepEqual(probeAudio('a.mp3', () => ({status: 0, stdout})), {
    title: '晴天',
    artist: '周杰伦',
    duration: 269.4,
  });
  assert.deepEqual(probeAudio('a.mp3', () => ({status: 1, stdout: ''})), {});
  assert.deepEqual(probeAudio('a.mp3', () => ({status: 0, stdout: 'not json'})), {});
});
