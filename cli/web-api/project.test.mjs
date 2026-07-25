import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {getProject} from './project.mjs';

const makeTempRoot = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tsuzuri-project-'));

test('assembles photos, audio, lyrics and output listings', () => {
  const root = makeTempRoot();
  fs.writeFileSync(path.join(root, 'a.jpg'), '');
  fs.writeFileSync(path.join(root, 'b.png'), '');
  fs.writeFileSync(path.join(root, 'song.mp3'), '');
  fs.writeFileSync(path.join(root, 'song.lrc'), '[00:01.00]hello\n[00:02.00]world\n');
  fs.mkdirSync(path.join(root, 'output', 'stills'), {recursive: true});
  fs.writeFileSync(path.join(root, 'output', 'stills', 'a.png'), '');
  fs.writeFileSync(path.join(root, 'output', `${path.basename(root)}.mp4`), '');

  const result = getProject(root, root);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.photos.map((p) => path.basename(p)).sort(), ['a.jpg', 'b.png']);
  assert.equal(path.basename(result.body.audio), 'song.mp3');
  assert.equal(path.basename(result.body.lyricsFile), 'song.lrc');
  assert.deepEqual(result.body.lyrics, [{time: 1, text: 'hello'}, {time: 2, text: 'world'}]);
  assert.deepEqual(result.body.output.stills.map((p) => path.basename(p)), ['a.png']);
  assert.equal(result.body.output.videos.length, 1);
});

test('includes filterConfig when tsuzuri.json is present and valid', () => {
  const root = makeTempRoot();
  fs.writeFileSync(path.join(root, 'tsuzuri.json'), JSON.stringify({filter: 'riso', intensity: 0.5}));
  const result = getProject(root, root);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.filterConfig, {filter: 'riso', intensity: 0.5});
});

test('does not blow up when tsuzuri.json is invalid, just omits filterConfig', () => {
  const root = makeTempRoot();
  fs.writeFileSync(path.join(root, 'tsuzuri.json'), '{not valid json');
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
