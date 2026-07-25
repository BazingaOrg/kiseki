import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {listDirs} from './dirs.mjs';

const makeTempRoot = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tsuzuri-dirs-'));

test('lists only folders, sorted, skipping dotfiles', () => {
  const root = makeTempRoot();
  fs.mkdirSync(path.join(root, 'b-folder'));
  fs.mkdirSync(path.join(root, 'a-folder'));
  fs.mkdirSync(path.join(root, '.hidden'));
  fs.writeFileSync(path.join(root, 'photo.jpg'), '');
  const result = listDirs(root, root);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.dirs.map((d) => d.name), ['a-folder', 'b-folder']);
});

test('includes the sandbox root path so the frontend can truncate breadcrumbs at it', () => {
  const root = makeTempRoot();
  const result = listDirs(root, root);
  assert.equal(result.body.root, path.resolve(root));
});

test('flags a folder with tsuzuri project hints', () => {
  const root = makeTempRoot();
  const project = path.join(root, 'trip');
  fs.mkdirSync(project);
  fs.writeFileSync(path.join(project, 'tsuzuri.toml'), '');
  const result = listDirs(root, root);
  assert.equal(result.body.dirs[0].isProject, true);
});

test('rejects a path outside the root with 403', () => {
  const root = makeTempRoot();
  const result = listDirs(root, path.join(root, '..', '..'));
  assert.equal(result.status, 403);
});

test('rejects .. traversal specifically', () => {
  const root = makeTempRoot();
  const result = listDirs(root, path.join(root, '..'));
  assert.equal(result.status, 403);
});

test('404s on a nonexistent path', () => {
  const root = makeTempRoot();
  const result = listDirs(root, path.join(root, 'nope'));
  assert.equal(result.status, 404);
});

test('400s when the path is a file, not a folder', () => {
  const root = makeTempRoot();
  const file = path.join(root, 'photo.jpg');
  fs.writeFileSync(file, '');
  const result = listDirs(root, file);
  assert.equal(result.status, 400);
});
