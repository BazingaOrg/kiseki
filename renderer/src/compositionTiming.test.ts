import assert from 'node:assert/strict';
import test from 'node:test';

import {filmstripLayerPresentation, polaroidCardPresentation} from './compositionTiming.ts';

test('filmstrip crossfade keeps the outgoing layer visible while the next photo enters', () => {
  const outgoing = filmstripLayerPresentation({time: 4, start: 0, end: 4, nextPhotoStart: 4, transitionDuration: 0.6});
  const incoming = filmstripLayerPresentation({time: 4, start: 4, end: 8, nextPhotoStart: null, transitionDuration: 0.6});
  assert.deepEqual(outgoing, {visible: true, opacity: 1});
  assert.equal(incoming.visible, true);
  assert.ok(incoming.opacity > 0);
});

test('polaroid replacement overlaps cards instead of fading through an empty stage', () => {
  const outgoing = polaroidCardPresentation({time: 4.15, start: 0, end: 4, nextPhotoStart: 4, rotation: -2});
  const incoming = polaroidCardPresentation({time: 4.15, start: 4, end: 8, nextPhotoStart: null, rotation: 3});
  assert.equal(outgoing.visible, true);
  assert.equal(incoming.visible, true);
  assert.ok(outgoing.opacity > 0);
  assert.ok(incoming.opacity > 0);
});

test('last polaroid card keeps the existing fade-out behavior', () => {
  const card = polaroidCardPresentation({time: 3.85, start: 0, end: 4, nextPhotoStart: null, rotation: 1});
  assert.equal(card.visible, true);
  assert.ok(Math.abs(card.opacity - 0.5) < Number.EPSILON);
  assert.equal(card.rotation, 1);
});
