import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {resolveSafePath} from './sandbox.mjs';

const makeTempRoot = () => fs.mkdtempSync(path.join(os.tmpdir(), 'kiseki-sandbox-'));

test('resolves a path inside the root', () => {
  const root = makeTempRoot();
  const child = path.join(root, 'photos');
  fs.mkdirSync(child);
  assert.equal(resolveSafePath(root, child), fs.realpathSync(child));
});

test('rejects .. traversal escaping the root', () => {
  const root = makeTempRoot();
  const outside = path.join(root, '..', '..', 'etc', 'passwd');
  assert.equal(resolveSafePath(root, outside), null);
});

test('rejects an absolute path outside the root even without ..', () => {
  const root = makeTempRoot();
  assert.equal(resolveSafePath(root, '/etc/passwd'), null);
});

test('rejects a symlink inside the root that points outside it', () => {
  const root = makeTempRoot();
  const outsideDir = makeTempRoot();
  const secretFile = path.join(outsideDir, 'secret.txt');
  fs.writeFileSync(secretFile, 'nope');
  const link = path.join(root, 'escape-link');
  fs.symlinkSync(outsideDir, link);
  assert.equal(resolveSafePath(root, path.join(link, 'secret.txt')), null);
});

test('returns the path under the real root for a nonexistent target (caller stats it, gets 404)', () => {
  const root = makeTempRoot();
  const target = path.join(root, 'nope.txt');
  assert.equal(resolveSafePath(root, target), path.join(fs.realpathSync(root), 'nope.txt'));
});

test('rejects null bytes', () => {
  const root = makeTempRoot();
  assert.equal(resolveSafePath(root, `${root}/foo\0bar`), null);
});

test('rejects empty or non-string input', () => {
  const root = makeTempRoot();
  assert.equal(resolveSafePath(root, ''), null);
  assert.equal(resolveSafePath(root, undefined), null);
  assert.equal(resolveSafePath(root, null), null);
});

test('accepts the root itself', () => {
  const root = makeTempRoot();
  assert.equal(resolveSafePath(root, root), fs.realpathSync(root));
});

test('accepts a lexical absolute path when the authorized root is already realpath', () => {
  const root = makeTempRoot();
  const realRoot = fs.realpathSync(root);
  const missing = path.join(root, 'missing.jpg');
  assert.equal(resolveSafePath(realRoot, missing), path.join(realRoot, 'missing.jpg'));
  assert.equal(resolveSafePath(realRoot, root), realRoot);
});
