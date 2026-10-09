import assert from 'node:assert/strict';
import test from 'node:test';

import {resolvePhotoTransition} from './transition.ts';

const clipTransition = {type: 'album' as const, duration: 0.4};
const templateTransition = {type: 'crossfade' as const, duration: 0.6};

test('template transition overrides ordinary photos', () => {
  assert.deepEqual(resolvePhotoTransition({clipTransition, templateTransition, openingRecapFirst: false}), templateTransition);
});

test('opening recap first photo stays fully opaque under the recap dissolve', () => {
  assert.deepEqual(resolvePhotoTransition({clipTransition, templateTransition, openingRecapFirst: true, openingRecapFade: 0.4}), {
    type: 'none',
    duration: 0,
  });
});
