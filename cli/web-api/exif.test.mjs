import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {getExif} from './exif.mjs';

const makeTempRoot = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tsuzuri-exif-'));

test('rejects a path outside the root with 403', async () => {
  const root = makeTempRoot();
  const result = await getExif(root, path.join(root, '..', '..', 'etc', 'passwd'));
  assert.equal(result.status, 403);
});

test('rejects an absolute path escaping the root', async () => {
  const root = makeTempRoot();
  const result = await getExif(root, '/etc/passwd');
  assert.equal(result.status, 403);
});

test('rejects a symlink inside the root pointing outside it', async () => {
  const root = makeTempRoot();
  const outside = path.join(makeTempRoot(), 'secret.jpg');
  fs.writeFileSync(outside, '');
  const link = path.join(root, 'link.jpg');
  fs.symlinkSync(outside, link);
  const result = await getExif(root, link);
  assert.equal(result.status, 403);
});

test('404s on a nonexistent path', async () => {
  const root = makeTempRoot();
  const result = await getExif(root, path.join(root, 'nope.jpg'));
  assert.equal(result.status, 404);
});

test('400s when the target is a directory', async () => {
  const root = makeTempRoot();
  const dir = path.join(root, 'sub');
  fs.mkdirSync(dir);
  const result = await getExif(root, dir);
  assert.equal(result.status, 400);
});

test('400s on a non-image file so exifr is never pointed at arbitrary content', async () => {
  const root = makeTempRoot();
  const file = path.join(root, 'notes.txt');
  fs.writeFileSync(file, 'hello');
  const result = await getExif(root, file);
  assert.equal(result.status, 400);
});

test('200s with null exif for an image that carries no metadata', async () => {
  const root = makeTempRoot();
  const file = path.join(root, 'blank.jpg');
  // 不是合法 JPEG,exifr 解析必然失败——正是"没有 EXIF"要走的分支
  fs.writeFileSync(file, 'not really a jpeg');
  const result = await getExif(root, file);
  assert.equal(result.status, 200);
  assert.equal(result.body.exif, null);
  assert.equal(result.body.displayable, false);
});
