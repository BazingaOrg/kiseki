import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {cacheKey, normalizeWidth, pruneCache, resolveThumb} from './thumb.mjs';

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

// --- 缓存修剪 --------------------------------------------------------------

test('缓存没超上限时一个都不删', () => {
  const dir = makeTempRoot();
  for (let i = 0; i < 5; i += 1) fs.writeFileSync(path.join(dir, `${i}.jpg`), 'x');
  assert.equal(pruneCache(dir, 10), 0);
  assert.equal(fs.readdirSync(dir).length, 5);
});

test('超出上限时砍到 80%,淘汰最久没被读过的', () => {
  const dir = makeTempRoot();
  // 造 12 个,访问时间递增:0 最旧,11 最新
  for (let i = 0; i < 12; i += 1) {
    const file = path.join(dir, `${i}.jpg`);
    fs.writeFileSync(file, 'x');
    const when = new Date(2020, 0, 1 + i);
    fs.utimesSync(file, when, when);
  }
  const removed = pruneCache(dir, 10);
  const left = fs.readdirSync(dir).map((name) => Number(name.replace('.jpg', ''))).sort((a, b) => a - b);
  assert.equal(left.length, 8, '10 的 80% = 8');
  assert.equal(removed, 4);
  assert.deepEqual(left, [4, 5, 6, 7, 8, 9, 10, 11], '留下的必须是最近读过的那批');
});

test('修剪不碰写了一半的临时文件', () => {
  const dir = makeTempRoot();
  for (let i = 0; i < 12; i += 1) fs.writeFileSync(path.join(dir, `${i}.jpg`), 'x');
  fs.writeFileSync(path.join(dir, 'half.123.abc.tmp.jpg'), 'x');
  pruneCache(dir, 4);
  assert.ok(fs.existsSync(path.join(dir, 'half.123.abc.tmp.jpg')), '正在写的文件不该被顺手删掉');
});

test('缓存目录不存在时修剪不报错', () => {
  assert.equal(pruneCache(path.join(makeTempRoot(), 'nope'), 10), 0);
});
