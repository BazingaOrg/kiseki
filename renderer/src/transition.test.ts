import assert from 'node:assert/strict';
import test from 'node:test';

import {resolvePhotoTransition} from './transition.ts';

const clipTransition = {type: 'album' as const, duration: 0.4};
const templateTransition = {type: 'crossfade' as const, duration: 0.6};

test('template transition overrides ordinary photos', () => {
  assert.deepEqual(resolvePhotoTransition({clipTransition, templateTransition, openingRecapFirst: false}), templateTransition);
});

test('opening recap first photo is fully opaque at the handoff', () => {
  assert.deepEqual(resolvePhotoTransition({clipTransition, templateTransition, openingRecapFirst: true}), {
    type: 'none',
    duration: 0,
  });
});
