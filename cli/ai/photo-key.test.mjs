import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {normalizePhotoKey} from './photo-key.mjs';

test('timeline, still basename and absolute paths share a project-relative key', () => {
  const root = path.join(os.tmpdir(), 'album');
  assert.equal(normalizePhotoKey(root, './001.jpg'), '001.jpg');
  assert.equal(normalizePhotoKey(root, '001.jpg'), '001.jpg');
  assert.equal(normalizePhotoKey(root, './photos/001.jpg'), 'photos/001.jpg');
  assert.equal(normalizePhotoKey(root, path.join(root, 'photos', '001.jpg')), 'photos/001.jpg');
  assert.equal(normalizePhotoKey(root, path.join(root, '001.jpg')), '001.jpg');
});

test('keys never collapse to basename-only across folders', () => {
  const root = '/trip';
  assert.notEqual(normalizePhotoKey(root, '001.jpg'), normalizePhotoKey(root, 'photos/001.jpg'));
});

test('paths outside the project root are rejected', () => {
  const root = path.resolve('/trip');
  assert.equal(normalizePhotoKey(root, '../secret.jpg'), null);
  assert.equal(normalizePhotoKey(root, '/etc/passwd'), null);
  assert.equal(normalizePhotoKey(root, ''), null);
});
