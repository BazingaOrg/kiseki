import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {cacheKey, normalizeWidth, resolveThumb} from './thumb.mjs';

const makeTempRoot = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tsuzuri-thumb-'));

test('width snaps to a fixed ladder so the cache does not explode', () => {
  assert.equal(normalizeWidth('44'), 128);
  assert.equal(normalizeWidth('128'), 128);
  assert.equal(normalizeWidth('300'), 400);
  assert.equal(normalizeWidth('99999'), 1024);
});

test('a missing or nonsense width falls back to the default', () => {
  assert.equal(normalizeWidth(null), 400);
  assert.equal(normalizeWidth('abc'), 400);
  assert.equal(normalizeWidth('-5'), 400);
});

test('cache key changes when the source file changes', () => {
  const base = {mtimeMs: 1000, size: 2048};
  const key = cacheKey('/a/b.jpg', base, 400);
  assert.notEqual(key, cacheKey('/a/b.jpg', {...base, mtimeMs: 1001}, 400), 'mtime 变了应当失效');
  assert.notEqual(key, cacheKey('/a/b.jpg', {...base, size: 4096}, 400), '大小变了应当失效');
  assert.notEqual(key, cacheKey('/a/b.jpg', base, 128), '宽度不同应当分开缓存');
  assert.notEqual(key, cacheKey('/a/c.jpg', base, 400), '不同文件应当分开缓存');
  assert.equal(key, cacheKey('/a/b.jpg', {...base}, 400), '同样的输入应当命中同一份缓存');
});

test('rejects a path outside the root with 403', async () => {
  const root = makeTempRoot();
  const result = await resolveThumb(root, path.join(root, '..', '..', 'secret.jpg'), '400');
  assert.equal(result.status, 403);
});

test('rejects an absolute path escaping the root', async () => {
  const root = makeTempRoot();
  const result = await resolveThumb(root, '/etc/passwd', '400');
  assert.equal(result.status, 403);
});

test('rejects a symlink inside the root pointing outside it', async () => {
  const root = makeTempRoot();
  const outside = path.join(makeTempRoot(), 'secret.jpg');
  fs.writeFileSync(outside, '');
  fs.symlinkSync(outside, path.join(root, 'link.jpg'));
  const result = await resolveThumb(root, path.join(root, 'link.jpg'), '400');
  assert.equal(result.status, 403);
});

test('404s on a nonexistent path', async () => {
  const root = makeTempRoot();
  const result = await resolveThumb(root, path.join(root, 'nope.jpg'), '400');
  assert.equal(result.status, 404);
});

test('400s on a directory and on a non-image file', async () => {
  const root = makeTempRoot();
  fs.mkdirSync(path.join(root, 'sub'));
  fs.writeFileSync(path.join(root, 'notes.txt'), 'hi');
  assert.equal((await resolveThumb(root, path.join(root, 'sub'), '400')).status, 400);
  assert.equal((await resolveThumb(root, path.join(root, 'notes.txt'), '400')).status, 400);
});

test('falls back to the original file when ffmpeg cannot decode it', async () => {
  const root = makeTempRoot();
  const broken = path.join(root, 'broken.jpg');
  fs.writeFileSync(broken, 'not really a jpeg');
  const result = await resolveThumb(root, broken, '400');
  // 宁可慢一点把原图发出去,也不要让页面开天窗。
  // 比对走 realpath:沙箱会展开符号链接(macOS 上 /var 实为 /private/var)
  assert.equal(result.status, 200);
  assert.equal(result.streamPath, fs.realpathSync(broken));
});
