import assert from 'node:assert/strict';
import test from 'node:test';

import {openingRecapFrameBounds, openingRecapFrameState} from './openingRecapTiming.ts';

const single = {
  start: 3,
  settle_start: 4,
  end: 4.25,
  order: 'reverse' as const,
  layout: 'single' as const,
  batch_size: 1,
};

test('recap runs backward and holds the last rewind photo while dissolving', () => {
  assert.deepEqual(openingRecapFrameState({frame: 179, fps: 60, photoCount: 5, spec: single}), {
    visible: false, settled: false, photoIndices: [], slotProgress: 0,
  });
  assert.deepEqual(openingRecapFrameState({frame: 180, fps: 60, photoCount: 5, spec: single}).photoIndices, [4]);
  assert.deepEqual(openingRecapFrameState({frame: 225, fps: 60, photoCount: 5, spec: single}).photoIndices, [1]);
  assert.deepEqual(openingRecapFrameState({frame: 240, fps: 60, photoCount: 5, spec: single}), {
    visible: true, settled: true, photoIndices: [1], slotProgress: 1,
  });
  assert.equal(openingRecapFrameState({frame: 255, fps: 60, photoCount: 5, spec: single}).visible, false);
});

test('recap plays one photo at a time regardless of layout metadata', () => {
  const grid = {...single, layout: 'grid' as const, batch_size: 4};
  const indices = openingRecapFrameState({
    frame: 180, fps: 60, photoCount: 10, spec: grid, stacked: true,
  }).photoIndices;
  assert.equal(indices.length, 1);
  const seen = new Set<number>();
  for (let frame = 180; frame < 240; frame += 1) {
    const state = openingRecapFrameState({frame, fps: 60, photoCount: 10, spec: grid, stacked: true});
    assert.equal(state.photoIndices.length, 1);
    seen.add(state.photoIndices[0]);
  }
  assert.deepEqual([...seen].sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
});

test('settled recap keeps the last rewind photo instead of cutting to photo 0', () => {
  const grid = {...single, layout: 'grid' as const, batch_size: 4};
  assert.deepEqual(
    openingRecapFrameState({frame: 240, fps: 60, photoCount: 10, spec: grid}).photoIndices,
    [1],
  );
  assert.deepEqual(
    openingRecapFrameState({frame: 240, fps: 60, photoCount: 10, spec: grid, stacked: true}).photoIndices,
    [1],
  );
  assert.deepEqual(
    openingRecapFrameState({frame: 240, fps: 60, photoCount: 8, spec: grid}).photoIndices,
    [1],
  );
});

test('legacy grid metadata still returns reverse-ordered single photos without losing photos', () => {
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
    assert.deepEqual(state.photoIndices, [1]);
    const bounds = openingRecapFrameBounds({fps, spec: lowFps});
    assert.equal(bounds.settleFrame, finalRecapFrame);
    assert.equal(bounds.endFrame, finalRecapFrame + 1);
  });
}
