import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {formatLyricsPreview, runLyrics} from './lyrics.mjs';
import {createTaskLeaseManager} from './task-lease.mjs';
import {term} from './term.mjs';

const originalTermTask = term.task;
term.task = () => ({succeed() {}, fail() {}, endLine() {}});
test.after(() => {
  term.task = originalTermTask;
});

const fixture = () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'kiseki-lyrics-'));
  return folder;
};
const runLyricsForTest = (folder, options) => runLyrics(folder, {
  ...options,
  leaseManager: createTaskLeaseManager({registryRoot: path.join(folder, '.runtime')}),
});
const recognized = (text) => JSON.stringify({backend: 'test', language: 'zh', segments: [{text, start: 0, end: 1, confidence: 1}]});
const macOSVarAlias = (folder) => {
  const canonical = fs.realpathSync(folder);
  const alias = canonical.replace(/^\/private\/var\//, '/var/');
  return alias !== canonical && fs.realpathSync(alias) === canonical ? alias : null;
};

test('zero segments produces the pure-music info line', () => {
  const lines = formatLyricsPreview({backend: 'lrc', language: 'en', segments: []});

  assert.equal(lines.length, 2);
  assert.equal(lines[0].kind, 'info');
  assert.match(lines[0].text, /来源: lrc · 语言: en/);
  assert.deepEqual(lines[1], {kind: 'info', text: '未识别到人声(纯音乐?),渲染时将跳过字幕'});
});

test('segments at or above the confidence threshold render as plain lines', () => {
  const lines = formatLyricsPreview({
    backend: 'lrc',
    language: 'ja',
    segments: [{text: '夜空', start: 1.5, end: 63.4, confidence: 1.0}],
  });

  assert.deepEqual(lines[1], {kind: 'line', text: '[00:01.5 → 01:03.4] 夜空'});
});

test('segments below the confidence threshold render as warnings with the render-skip note', () => {
  const lines = formatLyricsPreview(
    {
      backend: 'faster-whisper',
      language: 'ja',
      segments: [{text: 'low', start: 0, end: 1, confidence: 0.42}],
    },
    {confidenceThreshold: 0.6},
  );

  assert.equal(lines[1].kind, 'warn');
  assert.match(lines[1].text, /置信度 0\.42 低于渲染阈值 0\.6/);
  assert.match(lines[1].text, /不会显示/);
});

test('the confidence threshold is configurable and defaults to the renderer value', () => {
  const lines = formatLyricsPreview({
    backend: 'lrc',
    language: 'en',
    segments: [{text: 'borderline', start: 0, end: 1, confidence: 0.6}],
  });

  // exactly at the default 0.6 threshold counts as shown (>=), matching Diary.tsx's `>=` check
  assert.equal(lines[1].kind, 'line');
});

test('recognized lyrics require explicit replace before analyzer starts', async () => {
  const folder = fixture();
  try {
    fs.writeFileSync(path.join(folder, 'song.mp3'), 'audio');
    const metadata = path.join(folder, 'output', 'metadata');
    fs.mkdirSync(metadata, {recursive: true});
    fs.writeFileSync(path.join(metadata, 'lyrics.json'), recognized('old'));
    await assert.rejects(() => runLyricsForTest(folder, {runCommandImpl: () => { throw new Error('must not run'); }}), /--replace/);
  } finally { fs.rmSync(folder, {recursive: true, force: true}); }
});

test('failed replacement preserves old lyrics and downstream metadata', async () => {
  const folder = fixture();
  try {
    fs.writeFileSync(path.join(folder, 'song.mp3'), 'audio');
    const metadata = path.join(folder, 'output', 'metadata');
    fs.mkdirSync(metadata, {recursive: true});
    fs.writeFileSync(path.join(metadata, 'lyrics.json'), recognized('old'));
    fs.writeFileSync(path.join(metadata, 'timeline.json'), 'timeline');
    assert.equal(await runLyricsForTest(folder, {replace: true, runCommandImpl: () => 1}), 1);
    assert.match(fs.readFileSync(path.join(metadata, 'lyrics.json'), 'utf8'), /old/);
    assert.equal(fs.readFileSync(path.join(metadata, 'timeline.json'), 'utf8'), 'timeline');
  } finally { fs.rmSync(folder, {recursive: true, force: true}); }
});

test('replacement rejects an unusable staged payload without touching old lyrics or timeline', async () => {
  const folder = fixture();
  try {
    fs.writeFileSync(path.join(folder, 'song.mp3'), 'audio');
    const metadata = path.join(folder, 'output', 'metadata');
    fs.mkdirSync(metadata, {recursive: true});
    fs.writeFileSync(path.join(metadata, 'lyrics.json'), recognized('old'));
    fs.writeFileSync(path.join(metadata, 'timeline.json'), 'timeline');
    await assert.rejects(() => runLyricsForTest(folder, {replace: true, runCommandImpl: (_label, _command, args) => {
      fs.writeFileSync(args[args.indexOf('--lyrics-output') + 1], JSON.stringify({segments: []}));
      return 0;
    }}), /没有可用歌词/);
    assert.match(fs.readFileSync(path.join(metadata, 'lyrics.json'), 'utf8'), /old/);
    assert.equal(fs.readFileSync(path.join(metadata, 'timeline.json'), 'utf8'), 'timeline');
  } finally { fs.rmSync(folder, {recursive: true, force: true}); }
});

test('replacement rejects even an empty physical LRC file', async () => {
  const folder = fixture();
  try {
    fs.writeFileSync(path.join(folder, 'song.mp3'), 'audio');
    fs.writeFileSync(path.join(folder, 'song.lrc'), '');
    const metadata = path.join(folder, 'output', 'metadata');
    fs.mkdirSync(metadata, {recursive: true});
    fs.writeFileSync(path.join(metadata, 'lyrics.json'), recognized('old'));
    await assert.rejects(() => runLyricsForTest(folder, {replace: true, runCommandImpl: () => 0}), /LRC/);
  } finally { fs.rmSync(folder, {recursive: true, force: true}); }
});

test('replacement requires a current manageable recognized result', async () => {
  const folder = fixture();
  try {
    fs.writeFileSync(path.join(folder, 'song.mp3'), 'audio');
    await assert.rejects(() => runLyricsForTest(folder, {replace: true, runCommandImpl: () => 0}), /没有可替换/);
  } finally { fs.rmSync(folder, {recursive: true, force: true}); }
});

test('source drift during replacement prevents commit and preserves timeline', async () => {
  const folder = fixture();
  try {
    fs.writeFileSync(path.join(folder, 'song.mp3'), 'audio');
    const metadata = path.join(folder, 'output', 'metadata');
    fs.mkdirSync(metadata, {recursive: true});
    fs.writeFileSync(path.join(metadata, 'lyrics.json'), recognized('old'));
    fs.writeFileSync(path.join(metadata, 'timeline.json'), 'timeline');
    await assert.rejects(() => runLyricsForTest(folder, {replace: true, runCommandImpl: (_label, _command, args) => {
      fs.writeFileSync(path.join(metadata, 'lyrics.json'), recognized('changed'));
      fs.writeFileSync(args[args.indexOf('--lyrics-output') + 1], recognized('new'));
      return 0;
    }}), /已变化/);
    assert.match(fs.readFileSync(path.join(metadata, 'lyrics.json'), 'utf8'), /changed/);
    assert.equal(fs.readFileSync(path.join(metadata, 'timeline.json'), 'utf8'), 'timeline');
  } finally { fs.rmSync(folder, {recursive: true, force: true}); }
});

test('LRC appearing during replacement prevents commit', async () => {
  const folder = fixture();
  try {
    fs.writeFileSync(path.join(folder, 'song.mp3'), 'audio');
    const metadata = path.join(folder, 'output', 'metadata');
    fs.mkdirSync(metadata, {recursive: true});
    fs.writeFileSync(path.join(metadata, 'lyrics.json'), recognized('old'));
    fs.writeFileSync(path.join(metadata, 'timeline.json'), 'timeline');
    await assert.rejects(() => runLyricsForTest(folder, {replace: true, runCommandImpl: (_label, _command, args) => {
      fs.writeFileSync(path.join(folder, 'appeared.lrc'), 'malformed');
      fs.writeFileSync(args[args.indexOf('--lyrics-output') + 1], recognized('new'));
      return 0;
    }}), /已变化/);
    assert.equal(fs.readFileSync(path.join(metadata, 'timeline.json'), 'utf8'), 'timeline');
  } finally { fs.rmSync(folder, {recursive: true, force: true}); }
});

test('timeline drift after prepare and before commit rolls replacement back', async () => {
  const folder = fixture();
  try {
    fs.writeFileSync(path.join(folder, 'song.mp3'), 'audio');
    const metadata = path.join(folder, 'output', 'metadata');
    fs.mkdirSync(metadata, {recursive: true});
    fs.writeFileSync(path.join(metadata, 'lyrics.json'), recognized('old'));
    fs.writeFileSync(path.join(metadata, 'timeline.json'), 'old timeline');
    await assert.rejects(() => runLyricsForTest(folder, {
      replace: true,
      runCommandImpl: (_label, _command, args) => { fs.writeFileSync(args[args.indexOf('--lyrics-output') + 1], recognized('new')); return 0; },
      beforeMarkCommitting: () => fs.writeFileSync(path.join(metadata, 'timeline.json'), 'edited timeline'),
    }), /时间线已变化/);
    assert.match(fs.readFileSync(path.join(metadata, 'lyrics.json'), 'utf8'), /old/);
    assert.equal(fs.readFileSync(path.join(metadata, 'timeline.json'), 'utf8'), 'edited timeline');
  } finally { fs.rmSync(folder, {recursive: true, force: true}); }
});

test('lyrics or LRC drift at the commit boundary prevents installation', async () => {
  const folder = fixture();
  try {
    fs.writeFileSync(path.join(folder, 'song.mp3'), 'audio');
    const metadata = path.join(folder, 'output', 'metadata');
    fs.mkdirSync(metadata, {recursive: true});
    fs.writeFileSync(path.join(metadata, 'lyrics.json'), recognized('old'));
    await assert.rejects(() => runLyricsForTest(folder, {
      replace: true,
      runCommandImpl: (_label, _command, args) => { fs.writeFileSync(args[args.indexOf('--lyrics-output') + 1], recognized('new')); return 0; },
      beforeMarkCommitting: () => fs.writeFileSync(path.join(folder, 'appeared.lrc'), ''),
    }), /已变化/);
    assert.match(fs.readFileSync(path.join(metadata, 'lyrics.json'), 'utf8'), /old/);
  } finally { fs.rmSync(folder, {recursive: true, force: true}); }
});

test('successful replacement invalidates only lyrics-dependent timeline', async () => {
  const folder = fixture();
  try {
    fs.writeFileSync(path.join(folder, 'song.mp3'), 'audio');
    const metadata = path.join(folder, 'output', 'metadata');
    fs.mkdirSync(metadata, {recursive: true});
    fs.writeFileSync(path.join(metadata, 'lyrics.json'), recognized('old'));
    fs.writeFileSync(path.join(metadata, 'timeline.json'), 'timeline');
    fs.writeFileSync(path.join(metadata, 'analysis.json'), 'analysis');
    fs.writeFileSync(path.join(metadata, 'beats.json'), 'beats');
    assert.equal(await runLyricsForTest(folder, {replace: true, runCommandImpl: (_label, _command, args) => {
      fs.writeFileSync(args[args.indexOf('--lyrics-output') + 1], recognized('new'));
      return 0;
    }}), 0);
    assert.match(fs.readFileSync(path.join(metadata, 'lyrics.json'), 'utf8'), /new/);
    assert.equal(fs.existsSync(path.join(metadata, 'timeline.json')), false);
    assert.equal(fs.existsSync(path.join(metadata, 'analysis.json')), true);
    assert.equal(fs.existsSync(path.join(metadata, 'beats.json')), true);
  } finally { fs.rmSync(folder, {recursive: true, force: true}); }
});

test('replacement accepts a canonical metadata path reached through the macOS /var alias', {skip: !macOSVarAlias(os.tmpdir())}, async () => {
  const canonicalFolder = fixture();
  const folder = macOSVarAlias(canonicalFolder);
  try {
    fs.writeFileSync(path.join(folder, 'song.mp3'), 'audio');
    const metadata = path.join(folder, 'output', 'metadata');
    fs.mkdirSync(metadata, {recursive: true});
    fs.writeFileSync(path.join(metadata, 'lyrics.json'), recognized('old'));
    assert.equal(await runLyricsForTest(folder, {replace: true, runCommandImpl: (_label, _command, args) => {
      fs.writeFileSync(args[args.indexOf('--lyrics-output') + 1], recognized('new'));
      return 0;
    }}), 0);
    assert.match(fs.readFileSync(path.join(metadata, 'lyrics.json'), 'utf8'), /new/);
  } finally { fs.rmSync(canonicalFolder, {recursive: true, force: true}); }
});
