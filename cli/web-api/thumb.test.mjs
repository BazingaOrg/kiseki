import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {cacheKey, createPruner, etagFor, matchesIfNoneMatch, normalizeWidth, pruneCache, resolveThumb, runFfmpeg, THUMB_CONCURRENCY} from './thumb.mjs';

const makeTempRoot = () => fs.mkdtempSync(path.join(os.tmpdir(), 'kiseki-thumb-'));

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
  const base = {dev: 1, ino: 2, mtimeMs: 1000, ctimeMs: 1000, size: 2048};
  const key = cacheKey('/a/b.jpg', base, 400);
  assert.notEqual(key, cacheKey('/a/b.jpg', {...base, mtimeMs: 1001}, 400), 'mtime 变了应当失效');
  assert.notEqual(key, cacheKey('/a/b.jpg', {...base, size: 4096}, 400), '大小变了应当失效');
  assert.notEqual(key, cacheKey('/a/b.jpg', base, 128), '宽度不同应当分开缓存');
  assert.notEqual(key, cacheKey('/a/c.jpg', base, 400), '不同文件应当分开缓存');
  assert.equal(key, cacheKey('/a/b.jpg', {...base}, 400), '同样的输入应当命中同一份缓存');
  assert.notEqual(key, cacheKey('/a/b.jpg', {...base, ctimeMs: 1001}, 400), 'ctime 变了应当失效');
  assert.notEqual(key, cacheKey('/a/b.jpg', {...base, ino: 3}, 400), 'inode 变了应当失效');
});

test('ETag is strong and validators accept exact, lists, weak values, and *', () => {
  const tag = etagFor('/a/b.jpg', {dev: 1n, ino: 2n, size: 3n, mtimeNs: 4n, ctimeNs: 5n}, 400);
  assert.match(tag, /^"thumb-[a-f0-9]+"$/);
  assert.ok(matchesIfNoneMatch(tag, tag));
  assert.ok(matchesIfNoneMatch(`"other", W/${tag}`, tag));
  assert.ok(matchesIfNoneMatch('*', tag));
  assert.ok(!matchesIfNoneMatch('"other"', tag));
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

test('falls back to the original file when the generator fails, retaining the source ETag', async () => {
  const root = makeTempRoot();
  const broken = path.join(root, 'broken.jpg');
  fs.writeFileSync(broken, 'not really a jpeg');
  const result = await resolveThumb(root, broken, '400', undefined, {generator: async () => false, cacheDir: path.join(root, 'cache')});
  // 宁可慢一点把原图发出去,也不要让页面开天窗.
  // 比对走 realpath:沙箱会展开符号链接(macOS 上 /var 实为 /private/var)
  assert.equal(result.status, 200);
  assert.equal(result.streamPath, fs.realpathSync(broken));
  assert.equal(result.headers['Cache-Control'], 'private, no-cache');
  assert.ok(result.headers.ETag);
});

test('first response generates 200, then its ETag produces 304 without a stream path or content length', async () => {
  const root = makeTempRoot();
  const image = path.join(root, 'image.jpg');
  fs.writeFileSync(image, 'source');
  const cacheDir = path.join(root, 'cache');
  let generated = 0;
  const deps = {cacheDir, generator: async (_source, destination) => { generated += 1; fs.writeFileSync(destination, 'thumb'); return true; }};
  const first = await resolveThumb(root, image, '400', undefined, deps);
  assert.equal(first.status, 200);
  assert.equal(generated, 1);
  const cached = await resolveThumb(root, image, '400', first.headers.ETag, deps);
  assert.equal(cached.status, 304);
  assert.deepEqual(cached.headers, {ETag: first.headers.ETag, 'Cache-Control': 'private, no-cache'});
  assert.equal(cached.streamPath, undefined);
  assert.equal(generated, 1);
});

test('a mismatched validator is 200 and width identities stay isolated', async () => {
  const root = makeTempRoot();
  const image = path.join(root, 'image.jpg');
  fs.writeFileSync(image, 'source');
  const cacheDir = path.join(root, 'cache');
  const deps = {cacheDir, generator: async (_source, destination) => { fs.writeFileSync(destination, 'thumb'); return true; }};
  const narrow = await resolveThumb(root, image, '128', undefined, deps);
  const wide = await resolveThumb(root, image, '640', '"different"', deps);
  assert.equal(wide.status, 200);
  assert.notEqual(narrow.headers.ETag, wide.headers.ETag);
  assert.notEqual(narrow.streamPath, wide.streamPath);
});

test('same path and size with restored mtime still changes identity when ctime/inode change', () => {
  const base = {dev: 1n, ino: 2n, size: 3n, mtimeNs: 4n, ctimeNs: 5n};
  assert.notEqual(etagFor('/same.jpg', base, 400), etagFor('/same.jpg', {...base, ctimeNs: 6n}, 400));
  assert.notEqual(etagFor('/same.jpg', base, 400), etagFor('/same.jpg', {...base, ino: 7n}, 400));
});

test('source replacement during generation retries once with a fresh identity', async () => {
  const root = makeTempRoot();
  const image = path.join(root, 'image.jpg');
  fs.writeFileSync(image, 'source');
  const a = {isFile: () => true, dev: 1n, ino: 1n, size: 6n, mtimeNs: 1n, ctimeNs: 1n};
  const b = {isFile: () => true, dev: 1n, ino: 2n, size: 6n, mtimeNs: 2n, ctimeNs: 2n};
  let sourceReads = 0;
  let generated = 0;
  const result = await resolveThumb(root, image, '400', undefined, {
    cacheDir: path.join(root, 'cache'),
    statSync: (target) => target === fs.realpathSync(image) ? [a, b, b, b][sourceReads++] : {size: 5n},
    existsSync: () => false,
    mkdirSync: fs.mkdirSync,
    generator: async (_source, destination) => { generated += 1; fs.writeFileSync(destination, 'thumb'); return true; },
    renameSync: fs.renameSync,
  });
  assert.equal(result.status, 200);
  assert.equal(generated, 2);
  assert.match(result.headers.ETag, new RegExp('thumb-'));
});

test('continuously changing source returns 409 and removes only its pending files', async () => {
  const root = makeTempRoot();
  const image = path.join(root, 'image.jpg');
  fs.writeFileSync(image, 'source');
  const makeStat = (ino) => ({isFile: () => true, dev: 1n, ino: BigInt(ino), size: 6n, mtimeNs: BigInt(ino), ctimeNs: BigInt(ino)});
  let reads = 0;
  const cacheDir = path.join(root, 'cache');
  const result = await resolveThumb(root, image, '400', undefined, {
    cacheDir,
    statSync: (target) => target === fs.realpathSync(image) ? makeStat(++reads) : {size: 5n},
    existsSync: () => false,
    mkdirSync: fs.mkdirSync,
    generator: async (_source, destination) => { fs.writeFileSync(destination, 'thumb'); return true; },
    renameSync: fs.renameSync,
  });
  assert.equal(result.status, 409);
  assert.equal(fs.readdirSync(cacheDir).filter((name) => name.endsWith('.tmp.jpg')).length, 0);
});

// --- 缓存修剪 --------------------------------------------------------------

test('缓存没超上限时一个都不删', () => {
  const dir = makeTempRoot();
  for (let i = 0; i < 5; i += 1) fs.writeFileSync(path.join(dir, `${i.toString(16).padStart(40, '0')}.jpg`), 'x');
  assert.equal(pruneCache(dir, 10), 0);
  assert.equal(fs.readdirSync(dir).length, 5);
});

test('超出上限时砍到 80%,淘汰最久没被读过的', () => {
  const dir = makeTempRoot();
  // 造 12 个,访问时间递增:0 最旧,11 最新
  for (let i = 0; i < 12; i += 1) {
    const file = path.join(dir, `${i.toString(16).padStart(40, '0')}.jpg`);
    fs.writeFileSync(file, 'x');
    const when = new Date(2020, 0, 1 + i);
    fs.utimesSync(file, when, when);
  }
  const removed = pruneCache(dir, 10);
  const left = fs.readdirSync(dir).map((name) => Number.parseInt(name.replace('.jpg', ''), 16)).sort((a, b) => a - b);
  assert.equal(left.length, 8, '10 的 80% = 8');
  assert.equal(removed, 4);
  assert.deepEqual(left, [4, 5, 6, 7, 8, 9, 10, 11], '留下的必须是最近读过的那批');
});

test('修剪不碰写了一半的临时文件', () => {
  const dir = makeTempRoot();
  for (let i = 0; i < 12; i += 1) fs.writeFileSync(path.join(dir, `${i.toString(16).padStart(40, '0')}.jpg`), 'x');
  fs.writeFileSync(path.join(dir, 'half.123.abc.tmp.jpg'), 'x');
  pruneCache(dir, 4);
  assert.ok(fs.existsSync(path.join(dir, 'half.123.abc.tmp.jpg')), '正在写的文件不该被顺手删掉');
});

test('缓存目录不存在时修剪不报错', () => {
  assert.equal(pruneCache(path.join(makeTempRoot(), 'nope'), 10), 0);
});

test('ffmpeg 并发被限制在上限内,超出的排队等空位', async () => {
  const children = [];
  let active = 0;
  let maxActive = 0;
  const fakeSpawn = () => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    const handlers = {};
    const child = {
      on: (event, fn) => { handlers[event] = fn; },
      kill: () => {},
      close: () => {
        active -= 1;
        handlers.close?.(0);
      },
    };
    children.push(child);
    // 瞬时完成的假 ffmpeg:下一轮微任务自动结束,让排队任务继续放行
    queueMicrotask(() => child.close());
    return child;
  };
  const jobs = [];
  for (let i = 0; i < 10; i += 1) {
    jobs.push(runFfmpeg('/src.jpg', `/dst-${i}.jpg`, 400, {spawn: fakeSpawn, timeoutMs: 5000}));
  }
  await Promise.all(jobs);
  assert.equal(children.length, 10, '10 个请求全部执行');
  assert.ok(maxActive <= THUMB_CONCURRENCY, `并发峰值 ${maxActive} 超过上限 ${THUMB_CONCURRENCY}`);
});

test('卡死的 ffmpeg 超时后被 SIGKILL 并以失败返回', async () => {
  const kills = [];
  const fakeSpawn = () => ({
    on: () => {},
    kill: (signal) => { kills.push(signal); },
  });
  const ok = await runFfmpeg('/src.jpg', '/dst.jpg', 400, {spawn: fakeSpawn, timeoutMs: 30});
  assert.equal(ok, false);
  assert.deepEqual(kills, ['SIGKILL']);
});

test('pruner 冷启动校准真实数量,之后只在计数超限时才扫盘修剪', () => {
  const dir = makeTempRoot();
  const limit = 5;
  const named = (i) => path.join(dir, `${i.toString(16).padStart(40, '0')}.jpg`);
  for (let i = 0; i < 6; i += 1) fs.writeFileSync(named(i), 'x');
  const pruner = createPruner();

  // 冷启动:校准发现 6 个 > 5 → 立即修剪到 80% = 4
  assert.equal(pruner(dir, limit), 2);
  assert.equal(fs.readdirSync(dir).length, 4);

  // 再补 5 个(共 9):计数 1..5 都不到 6,不触发修剪
  for (let i = 10; i < 15; i += 1) fs.writeFileSync(named(i), 'x');
  assert.equal(pruner(dir, limit), 0);
  assert.equal(pruner(dir, limit), 0);
  assert.equal(pruner(dir, limit), 0);
  assert.equal(pruner(dir, limit), 0);
  assert.equal(pruner(dir, limit), 0);
  assert.equal(fs.readdirSync(dir).length, 9, '计数未超限时绝不扫盘');

  // 第 6 次生成后计数 6 > 5 → 修剪:9 → 4,删 5
  assert.equal(pruner(dir, limit), 5);
  assert.equal(fs.readdirSync(dir).length, 4);
});
