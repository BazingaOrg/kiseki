import assert from 'node:assert/strict';
import test from 'node:test';

import {findSingleFrameDiscontinuities, meanPixelDifference} from './render-frame-integrity.mjs';

const frame = (value) => Buffer.alloc(64 * 64, value);

test('finds an isolated frame that disappears and immediately returns', () => {
  const frames = [frame(35), frame(36), frame(255), frame(36), frame(37)];
  assert.deepEqual(findSingleFrameDiscontinuities(frames), [2]);
  assert.ok(meanPixelDifference(frames[1], frames[2]) > 8);
});

test('does not flag a lasting scene change or a small frame variation', () => {
  assert.deepEqual(findSingleFrameDiscontinuities([frame(35), frame(36), frame(170), frame(171)]), []);
  assert.deepEqual(findSingleFrameDiscontinuities([frame(35), frame(36), frame(39), frame(37)]), []);
});

test('finds an isolated blank frame when the surrounding picture is moving', () => {
  assert.deepEqual(findSingleFrameDiscontinuities([frame(35), frame(37), frame(255), frame(40), frame(42)]), [2]);
});
