import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {getProject} from './project.mjs';

const makeTempRoot = () => fs.mkdtempSync(path.join(os.tmpdir(), 'kiseki-project-'));

test('assembles photos, audio, lyrics and output listings', () => {
  const root = makeTempRoot();
  fs.writeFileSync(path.join(root, 'a.jpg'), '');
  fs.writeFileSync(path.join(root, 'b.png'), '');
  fs.writeFileSync(path.join(root, 'song.mp3'), '');
  fs.writeFileSync(path.join(root, 'song.lrc'), '[00:01.00]hello\n[00:02.00]world\n');
  fs.mkdirSync(path.join(root, 'output', 'stills'), {recursive: true});
  fs.writeFileSync(path.join(root, 'output', 'stills', 'a.png'), '');
  fs.writeFileSync(path.join(root, 'output', 'stills', '.kiseki-partial-lease-a.png'), '');
  fs.writeFileSync(path.join(root, 'output', `${path.basename(root)}.mp4`), '');
  fs.writeFileSync(path.join(root, 'output', '.kiseki-partial-lease-video.mp4'), '');

  const result = getProject(root, root);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.photos.map((p) => path.basename(p)).sort(), ['a.jpg', 'b.png']);
  assert.equal(path.basename(result.body.audio), 'song.mp3');
  assert.equal(path.basename(result.body.lyricsFile), 'song.lrc');
  // until 标记「这一句到点该收了」,没有空行标记时为 null
  assert.deepEqual(result.body.lyrics, [
    {time: 1, text: 'hello', until: null},
    {time: 2, text: 'world', until: null},
  ]);
  assert.deepEqual(result.body.output.stills.map((p) => path.basename(p)), ['a.png']);
  assert.equal(result.body.output.videos.length, 1);
});

test('includes filterConfig when kiseki.json is present and valid', () => {
  const root = makeTempRoot();
  fs.writeFileSync(path.join(root, 'kiseki.json'), JSON.stringify({filter: 'riso', intensity: 0.5}));
  const result = getProject(root, root);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.filterConfig, {filter: 'riso', intensity: 0.5});
});

test('does not blow up when kiseki.json is invalid, just omits filterConfig', () => {
  const root = makeTempRoot();
  fs.writeFileSync(path.join(root, 'kiseki.json'), '{not valid json');
  const result = getProject(root, root);
  assert.equal(result.status, 200);
  assert.equal(result.body.filterConfig, null);
});

test('works on an empty folder without throwing (loose scan, no required audio)', () => {
  const root = makeTempRoot();
  const result = getProject(root, root);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.photos, []);
  assert.equal(result.body.audio, null);
  assert.equal(result.body.lyrics, null);
});

test('rejects a path outside the root with 403', () => {
  const root = makeTempRoot();
  const result = getProject(root, path.join(root, '..'));
  assert.equal(result.status, 403);
});

test('404s on a nonexistent path', () => {
  const root = makeTempRoot();
  const result = getProject(root, path.join(root, 'nope'));
  assert.equal(result.status, 404);
});

test('400s when the path is a file, not a folder', () => {
  const root = makeTempRoot();
  const file = path.join(root, 'photo.jpg');
  fs.writeFileSync(file, '');
  const result = getProject(root, file);
  assert.equal(result.status, 400);
});

// --- 歌词归一:.lrc 与本地识别产物的取舍 ---------------------------------

const writeRecognized = (root, segments) => {
  const metadataDir = path.join(root, 'output', 'metadata');
  fs.mkdirSync(metadataDir, {recursive: true});
  fs.writeFileSync(path.join(metadataDir, 'lyrics.json'), JSON.stringify({segments}));
};

test('any physical .lrc masks recognized management even when it has no timed lines', () => {
  const root = makeTempRoot();
  fs.writeFileSync(path.join(root, 'music.mp3'), '');
  // 只有元数据标签、没有一行带时间的歌词 —— parseLrc 会回 [] 而不是抛错
  fs.writeFileSync(path.join(root, 'music.lrc'), '[ti:Yellow]\n[ar:Coldplay]\n');
  writeRecognized(root, [{start: 1.5, text: 'recognized line', confidence: 0.9}]);

  const {body} = getProject(root, root);
  assert.equal(body.lyricsSource, null);
  assert.equal(body.recognizedLyricsManageable, false);
});

test('recognized segments are sorted by time', () => {
  const root = makeTempRoot();
  fs.writeFileSync(path.join(root, 'music.mp3'), '');
  // whisper 的输出顺序不保证升序,而前端找当前行是"遇到第一个更晚的就停"
  writeRecognized(root, [
    {start: 9, text: 'third'},
    {start: 1, text: 'first'},
    {start: 5, text: 'second'},
  ]);

  const {body} = getProject(root, root);
  assert.deepEqual(body.lyrics.map((line) => line.text), ['first', 'second', 'third']);
});

test('legacy recognized segment without end remains manageable', () => {
  const root = makeTempRoot();
  fs.writeFileSync(path.join(root, 'music.mp3'), '');
  writeRecognized(root, [{start: 1, text: 'legacy'}]);
  const {body} = getProject(root, root);
  assert.equal(body.lyricsSource, 'recognized');
  assert.equal(body.recognizedLyricsManageable, true);
});

test('a recognition result whose segments are all malformed counts as no lyrics', () => {
  const root = makeTempRoot();
  fs.writeFileSync(path.join(root, 'music.mp3'), '');
  writeRecognized(root, [{start: 'nope', text: 1}, {}]);

  const {body} = getProject(root, root);
  assert.equal(body.lyrics, null);
  assert.equal(body.lyricsSource, null, '一行都没剩下时不该标注成 recognized');
});

test('a real .lrc still wins over the recognized product', () => {
  const root = makeTempRoot();
  fs.writeFileSync(path.join(root, 'music.mp3'), '');
  fs.writeFileSync(path.join(root, 'music.lrc'), '[00:01.00]from lrc\n');
  writeRecognized(root, [{start: 2, text: 'from whisper'}]);

  const {body} = getProject(root, root);
  assert.equal(body.lyricsSource, 'lrc');
  assert.equal(body.lyrics[0].text, 'from lrc');
});

test('missing confidence becomes null rather than being dropped', () => {
  const root = makeTempRoot();
  fs.writeFileSync(path.join(root, 'music.mp3'), '');
  writeRecognized(root, [{start: 0, text: 'no confidence field'}]);

  const {body} = getProject(root, root);
  assert.equal(body.lyrics[0].confidence, null);
});

test('lrc 里只有时间戳的空行转成上一句的 until,不再自己占一行', () => {
  // 这类行是"上一句到此为止"的标记(间奏、留白).丢掉它,间奏那十几秒里
  // 上一句会一直挂着高亮不消失;把它当成一行歌词,列表里又会多出一堆 ⋯.
  const root = makeTempRoot();
  fs.writeFileSync(path.join(root, 'music.mp3'), '');
  fs.writeFileSync(
    path.join(root, 'music.lrc'),
    ['[00:01.00]第一句', '[00:05.00]', '[00:09.00]第二句', '[00:12.00]第三句'].join('\n'),
  );
  const {body} = getProject(root, root);
  assert.deepEqual(body.lyrics, [
    {time: 1, text: '第一句', until: 5},
    {time: 9, text: '第二句', until: null},
    {time: 12, text: '第三句', until: null},
  ]);
});

test('开头就是空行时不炸,也不凭空造出一行', () => {
  const root = makeTempRoot();
  fs.writeFileSync(path.join(root, 'music.mp3'), '');
  fs.writeFileSync(path.join(root, 'music.lrc'), ['[00:00.00]', '[00:03.00]开场'].join('\n'));
  const {body} = getProject(root, root);
  assert.deepEqual(body.lyrics, [{time: 3, text: '开场', until: null}]);
});
