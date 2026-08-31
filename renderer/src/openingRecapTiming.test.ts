import assert from 'node:assert/strict';
import test from 'node:test';

import {openingRecapFrameState} from './openingRecapTiming.ts';

const single = {
  start: 3,
  settle_start: 4,
  end: 4.25,
  order: 'reverse' as const,
  layout: 'single' as const,
  batch_size: 1,
};

test('recap runs backward and settles on the first photo', () => {
  assert.deepEqual(openingRecapFrameState({frame: 179, fps: 60, photoCount: 5, spec: single}), {
    visible: false, settled: false, photoIndices: [], slotProgress: 0,
  });
  assert.deepEqual(openingRecapFrameState({frame: 180, fps: 60, photoCount: 5, spec: single}).photoIndices, [4]);
  assert.deepEqual(openingRecapFrameState({frame: 225, fps: 60, photoCount: 5, spec: single}).photoIndices, [1]);
  assert.deepEqual(openingRecapFrameState({frame: 240, fps: 60, photoCount: 5, spec: single}), {
    visible: true, settled: true, photoIndices: [0], slotProgress: 1,
  });
  assert.equal(openingRecapFrameState({frame: 255, fps: 60, photoCount: 5, spec: single}).visible, false);
});

test('grid recap returns reverse-ordered batches without losing photos', () => {
  const grid = {...single, layout: 'grid' as const, batch_size: 4};
  const seen = new Set<number>();
  for (let frame = 180; frame < 240; frame += 1) {
    for (const index of openingRecapFrameState({frame, fps: 60, photoCount: 10, spec: grid}).photoIndices) {
      seen.add(index);
    }
  }
  assert.deepEqual([...seen].sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
});

test('fractional beat timestamps cover the handoff frame without a blank', () => {
  const fractional = {...single, settle_start: 3.767, end: 4.017};
  assert.equal(openingRecapFrameState({frame: 241, fps: 60, photoCount: 5, spec: fractional}).visible, true);
  assert.equal(openingRecapFrameState({frame: 242, fps: 60, photoCount: 5, spec: fractional}).visible, false);
});

for (const fps of [2, 3]) {
  test(`${fps}fps keeps at least one settled first-photo frame`, () => {
    const lowFps = {...single, start: 1, settle_start: 3.75, end: 4};
    const finalRecapFrame = Math.ceil(lowFps.end * fps) - 1;
    const state = openingRecapFrameState({frame: finalRecapFrame, fps, photoCount: 8, spec: lowFps});
    assert.equal(state.visible, true);
    assert.equal(state.settled, true);
    assert.deepEqual(state.photoIndices, [0]);
  });
}
