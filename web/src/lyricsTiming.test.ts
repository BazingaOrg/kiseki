import assert from 'node:assert/strict';
import test from 'node:test';

import {findActiveLine} from './lyricsTiming.ts';
import type {LyricLine} from './types.ts';

const line = (time: number, until?: number): LyricLine => ({time, until, text: 'lyric'});

test('active lyric ends after eight seconds even with a later explicit boundary', () => {
  assert.equal(findActiveLine([line(1, 12)], 8.99), 0);
  assert.equal(findActiveLine([line(1, 12)], 9), -1);
});

test('an earlier explicit boundary remains authoritative', () => {
  assert.equal(findActiveLine([line(1, 4)], 3.99), 0);
  assert.equal(findActiveLine([line(1, 4)], 4), -1);
});

test('next lyric takes over at its own cue', () => {
  const lyrics = [line(1), line(5)];
  assert.equal(findActiveLine(lyrics, 4.99), 0);
  assert.equal(findActiveLine(lyrics, 5), 1);
});
