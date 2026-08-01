import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {installDownloadedAudio} from './fetch.mjs';
import {AUDIO_PROVIDER_LIMIT, AUDIO_SEARCH_LIMIT, checkYtDlp, downloadWithYtDlp, normalizeSearchQuery, parseSearchCandidates, parseSearchLine, searchYtDlp} from './ytdlp.mjs';

test('search normalization only trims and collapses whitespace', () => {
  assert.equal(normalizeSearchQuery('  晴天   + 周杰伦 · live  '), '晴天 + 周杰伦 · live');
});

test('parseSearchLine splits yt-dlp print output and tolerates NA fields', () => {
  assert.deepEqual(parseSearchLine('abc123\t晴天 (官方MV)\t4:29\t周杰倫'), {
    id: 'abc123',
    title: '晴天 (官方MV)',
    duration: '4:29',
    uploader: '周杰倫',
  });
  assert.deepEqual(parseSearchLine('abc123\tTitle\tNA\tNA'), {
    id: 'abc123',
    title: 'Title',
    duration: '?:??',
    uploader: '未知频道',
  });
  assert.equal(parseSearchLine(''), null);
  assert.equal(parseSearchLine('only-one-field'), null);
});

test('parseSearchCandidates 稳定按 id 去重后限制为 10 个候选', () => {
  const lines = Array.from({length: AUDIO_SEARCH_LIMIT + 2}, (_, index) =>
    `${index === 3 ? '2' : index}\tSong ${index}\t3:01\tChannel`,
  );
  const candidates = parseSearchCandidates(lines.join('\n'));
  assert.equal(candidates.length, AUDIO_SEARCH_LIMIT);
  assert.deepEqual(candidates.map(({id}) => id), ['0', '1', '2', '4', '5', '6', '7', '8', '9', '10']);
});

test('sync search asks the provider for 20 before stable dedupe/slice to 10', () => {
  let args;
  const result = searchYtDlp('  晴天   周杰伦  ', {
    spawn: (_command, received) => {
      args = received;
      return {status: 0, stdout: Array.from({length: 12}, (_, index) => `${index}\tSong\t3:01\tChannel`).join('\n')};
    },
  });
  assert.equal(args[0], `ytsearch${AUDIO_PROVIDER_LIMIT}:晴天 周杰伦`);
  assert.equal(result.candidates.length, AUDIO_SEARCH_LIMIT);
});

test('yt-dlp downloads outside the material folder and safely replaces a same-name audio', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tsuzuri-fetch-test-'));
  const folder = path.join(root, 'material');
  fs.mkdirSync(folder);
  const oldFile = path.join(folder, 'Song - Artist.m4a');
  fs.writeFileSync(oldFile, 'old audio');

  let spawnCount = 0;
  const result = downloadWithYtDlp('https://example.test/video', {
    tempParent: root,
    stdio: 'pipe',
    spawn: (_command, args) => {
      spawnCount += 1;
      const template = args[args.indexOf('-o') + 1];
      const output = template.replace('%(title)s', 'remote-video-title').replace('%(ext)s', 'm4a');
      fs.writeFileSync(output, 'new audio');
      return {status: 0};
    },
  });

  try {
    assert.equal(result.ok, true);
    assert.equal(spawnCount, 1);
    assert.equal(fs.readFileSync(oldFile, 'utf8'), 'old audio');
    assert.notEqual(path.dirname(result.source), folder);
    const installed = installDownloadedAudio({
      source: result.source,
      folder,
      filename: 'Song - Artist.m4a',
      existing: 'Song - Artist.m4a',
    });
    assert.equal(installed, 'audio/Song - Artist.m4a');
    assert.equal(fs.existsSync(oldFile), false);
    assert.equal(fs.readFileSync(path.join(folder, installed), 'utf8'), 'new audio');
    assert.deepEqual(fs.readdirSync(folder), ['audio']);
  } finally {
    fs.rmSync(root, {recursive: true, force: true});
  }
});

test('checkYtDlp reports missing binary without throwing', () => {
  assert.deepEqual(checkYtDlp(() => ({error: new Error('ENOENT')})), {ok: false});
  assert.deepEqual(checkYtDlp(() => ({status: 0, stdout: '2026.01.01\n'})), {ok: true, version: '2026.01.01'});
});
