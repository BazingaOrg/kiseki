import assert from 'node:assert/strict';
import test from 'node:test';

import {ALL_TAG, EMPTY_FILM, applyFilmPatch, effectiveChoice, inverseFilmPatch, overrideCount, rollsForTag} from './film-state.ts';

test('photos follow the roll until they get their own choice', () => {
  const roll = applyFilmPatch(EMPTY_FILM, {roll: 'classic-chrome', strength: 0.8});
  assert.deepEqual(effectiveChoice(roll, 'photo:a.jpg'), {roll: 'classic-chrome', strength: 0.8, overridden: false});
  const single = applyFilmPatch(roll, {photo: {assetId: 'photo:a.jpg', roll: null}});
  assert.deepEqual(effectiveChoice(single, 'photo:a.jpg'), {roll: null, strength: 0.8, overridden: true});
  assert.equal(effectiveChoice(single, 'photo:b.jpg').roll, 'classic-chrome');
  assert.equal(overrideCount(single, ['photo:a.jpg', 'photo:b.jpg']), 1);
  const back = applyFilmPatch(single, {photo: {assetId: 'photo:a.jpg', inherit: true}});
  assert.equal(effectiveChoice(back, 'photo:a.jpg').overridden, false);
});

test('inverse patches undo roll and photo changes', () => {
  const start = applyFilmPatch(EMPTY_FILM, {roll: 'velvia'});
  const rollPatch = {roll: 'acros'};
  assert.deepEqual(applyFilmPatch(applyFilmPatch(start, rollPatch), inverseFilmPatch(start, rollPatch)), start);
  const photoPatch = {photo: {assetId: 'photo:x.jpg', roll: 'acros'}};
  const changed = applyFilmPatch(start, photoPatch);
  assert.deepEqual(applyFilmPatch(changed, inverseFilmPatch(start, photoPatch)), start);
  const second = {photo: {assetId: 'photo:x.jpg', strength: 0.5}};
  assert.deepEqual(applyFilmPatch(applyFilmPatch(changed, second), inverseFilmPatch(changed, second)), changed);
});

test('tag filter narrows the roll list', () => {
  assert.ok(rollsForTag(ALL_TAG).length >= 16);
  assert.ok(rollsForTag('黑白').every((roll) => roll.tags.includes('黑白')));
  assert.ok(rollsForTag('黑白').length >= 2);
});
