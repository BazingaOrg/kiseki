import assert from 'node:assert/strict';
import test from 'node:test';

import {coverUntil, fadeRange, resolvePhotoTransition} from './transition.ts';

const clipTransition = {type: 'album' as const, duration: 0.4};
const templateTransition = {type: 'crossfade' as const, duration: 0.6};

test('template transition overrides ordinary photos', () => {
  assert.deepEqual(resolvePhotoTransition({clipTransition, templateTransition, openingRecapFirst: false}), templateTransition);
});

test('album fade starts at the switch and crossfade stays centered on it', () => {
  assert.deepEqual(fadeRange({type: 'album', duration: 0.25}, 4), [4, 4.25]);
  assert.deepEqual(fadeRange({type: 'crossfade', duration: 0.6}, 4), [3.7, 4.3]);
  assert.equal(fadeRange({type: 'cut', duration: 0}, 4), null);
  assert.ok(Math.abs(coverUntil({type: 'album', duration: 0.25}, 8) - 8.25) < 1e-9);
  assert.ok(Math.abs(coverUntil({type: 'crossfade', duration: 0.6}, 8) - 8.3) < 1e-9);
  assert.equal(coverUntil({type: 'cut', duration: 0}, 8), 8);
});

test('opening recap first photo stays fully opaque under the recap dissolve', () => {
  assert.deepEqual(resolvePhotoTransition({clipTransition, templateTransition, openingRecapFirst: true, openingRecapFade: 0.4}), {
    type: 'none',
    duration: 0,
  });
});
