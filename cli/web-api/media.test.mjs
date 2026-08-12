import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {resolveMedia} from './media.mjs';

const makeTempRoot = () => fs.mkdtempSync(path.join(os.tmpdir(), 'kiseki-media-'));

test('serves a full file with correct content type and length', () => {
  const root = makeTempRoot();
  const file = path.join(root, 'photo.jpg');
  fs.writeFileSync(file, Buffer.from('x'.repeat(100)));
  const result = resolveMedia(root, file);
  assert.equal(result.status, 200);
  assert.equal(result.headers['Content-Type'], 'image/jpeg');
  assert.equal(result.headers['Content-Length'], '100');
});

test('serves a byte range with 206 and Content-Range', () => {
  const root = makeTempRoot();
  const file = path.join(root, 'clip.mp4');
  fs.writeFileSync(file, Buffer.from('y'.repeat(1000)));
  const result = resolveMedia(root, file, 'bytes=100-199');
  assert.equal(result.status, 206);
  assert.equal(result.headers['Content-Range'], 'bytes 100-199/1000');
  assert.equal(result.headers['Content-Length'], '100');
});

test('rejects .. traversal', () => {
  const root = makeTempRoot();
  const result = resolveMedia(root, path.join(root, '..', '..', 'etc', 'passwd'));
  assert.equal(result.status, 403);
});

test('rejects percent-encoded traversal (caller must not double-decode, but raw ..%2f string is still just a literal path here)', () => {
  const root = makeTempRoot();
  // 若上层误把 "..%2f" 当作字面路径传入(未先 decodeURIComponent),它不构成
  // 有效路径分隔符,resolve 后仍在 root 内部但目标不存在 → 404,不会越界.
  const result = resolveMedia(root, path.join(root, '..%2f..%2fetc%2fpasswd'));
  assert.equal(result.status, 404);
});

test('rejects an absolute path outside the root', () => {
  const root = makeTempRoot();
  const result = resolveMedia(root, '/etc/passwd');
  assert.equal(result.status, 403);
});

test('rejects a symlink inside the root pointing outside it', () => {
  const root = makeTempRoot();
  const outsideDir = makeTempRoot();
  const secret = path.join(outsideDir, 'secret.jpg');
  fs.writeFileSync(secret, 'nope');
  const link = path.join(root, 'escape.jpg');
  fs.symlinkSync(secret, link);
  const result = resolveMedia(root, link);
  assert.equal(result.status, 403);
});

test('404s on a nonexistent file', () => {
  const root = makeTempRoot();
  const result = resolveMedia(root, path.join(root, 'nope.jpg'));
  assert.equal(result.status, 404);
});

test('403s when the path is a directory, not a file', () => {
  const root = makeTempRoot();
  const dir = path.join(root, 'sub');
  fs.mkdirSync(dir);
  const result = resolveMedia(root, dir);
  assert.equal(result.status, 403);
});

test('truncates a range end beyond the file size instead of falling back to 200', () => {
  const root = makeTempRoot();
  const file = path.join(root, 'clip.mp4');
  fs.writeFileSync(file, Buffer.from('y'.repeat(1000)));
  const result = resolveMedia(root, file, 'bytes=100-999999');
  assert.equal(result.status, 206);
  assert.equal(result.headers['Content-Range'], 'bytes 100-999/1000');
  assert.equal(result.headers['Content-Length'], '900');
});

test('rejects an invalid range by falling back to a full response', () => {
  const root = makeTempRoot();
  const file = path.join(root, 'photo.jpg');
  fs.writeFileSync(file, Buffer.from('z'.repeat(10)));
  const result = resolveMedia(root, file, 'bytes=5000-6000');
  assert.equal(result.status, 200);
});
