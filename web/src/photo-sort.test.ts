import assert from 'node:assert/strict';
import test from 'node:test';

import {normalizePhotoSort, shotTimeKey, sortPhotoPaths} from './photo-sort.ts';

test('chronological order is the default and legacy filename state migrates to it', () => {
  const paths = ['/album/2.jpg', '/album/1.jpg'];
  assert.equal(normalizePhotoSort(null), 'shot-asc');
  assert.equal(normalizePhotoSort('filename'), 'shot-asc');
  assert.deepEqual(sortPhotoPaths(paths, {sort: 'shot-asc'}), paths);
});

test('shot-asc is chronological and shot-desc reverses it', () => {
  const paths = ['/album/late.jpg', '/album/early.jpg', '/album/none.jpg'];
  const shotTimes = new Map<string, string | null>([
    ['/album/late.jpg', '2026.05.21 18:42'],
    ['/album/early.jpg', '2024-01-02 09:01'],
    ['/album/none.jpg', null],
  ]);
  assert.deepEqual(
    sortPhotoPaths(paths, {sort: 'shot-asc', shotTimes}),
    ['/album/early.jpg', '/album/late.jpg', '/album/none.jpg'],
  );
  assert.deepEqual(
    sortPhotoPaths(paths, {sort: 'shot-desc', shotTimes}),
    ['/album/late.jpg', '/album/early.jpg', '/album/none.jpg'],
  );
  assert.equal(shotTimeKey('2026.05.21 18:42:07'), '20260521184207000');
  assert.equal(shotTimeKey('20260521184233123'), '20260521184233123');
});

test('burst shots in the same minute keep second order and ignore file mtime', () => {
  const paths = ['/album/b.jpg', '/album/a.jpg', '/album/c.jpg'];
  const shotTimes = new Map<string, string | null>([
    ['/album/b.jpg', '20260521184210000'],
    ['/album/a.jpg', '20260521184209000'],
    ['/album/c.jpg', '20260521184210050'],
  ]);
  assert.deepEqual(
    sortPhotoPaths(paths, {sort: 'shot-asc', shotTimes}),
    ['/album/a.jpg', '/album/b.jpg', '/album/c.jpg'],
  );
});

test('photos without DateTimeOriginal keep filename order instead of mtime', () => {
  const paths = ['/album/2.jpg', '/album/1.jpg', '/album/3.jpg'];
  const shotTimes = new Map<string, string | null>([
    ['/album/2.jpg', null],
    ['/album/1.jpg', null],
    ['/album/3.jpg', null],
  ]);
  assert.deepEqual(
    sortPhotoPaths(paths, {sort: 'shot-asc', shotTimes}),
    ['/album/2.jpg', '/album/1.jpg', '/album/3.jpg'],
  );
});
