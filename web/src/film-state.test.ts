import assert from 'node:assert/strict';
import test from 'node:test';
import {photoStripTarget} from './photo-strip-scroll.ts';
import {filmSeedFor} from '../../cli/film-settings.mjs';
import {seedFor} from './film-preview.ts';

import {ALL_TAG, EMPTY_FILM, applyFilmPatch, createFilmSaveQueue, effectiveChoice, inverseFilmPatch, nextFilmViewMode, swapFilmViewMode, filmViewAction, filmViewLabel, overrideCount, rollsForTag} from './film-state.ts';

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


test('closing waits for every strength change to reach storage', async () => {
  let stored = {...EMPTY_FILM, roll: 'velvia'};
  const releases: (() => void)[] = [];
  const queue = createFilmSaveQueue(stored, async (patch) => {
    await new Promise<void>((resolve) => releases.push(resolve));
    stored = applyFilmPatch(stored, patch);
    return {ok: true, data: stored};
  }, () => {});
  queue.enqueue({strength: 0.8});
  queue.enqueue({strength: 0.35});
  let closed = false;
  const closing = queue.flush().then((ok) => { closed = ok; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(closed, false);
  releases.shift()!();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(closed, false);
  releases.shift()!();
  await closing;
  assert.equal(closed, true);
  assert.equal(stored.strength, 0.35);
  assert.deepEqual(queue.current(), stored);
});

test('failed earlier saves do not roll back later confirmed changes', async () => {
  let stored = {...EMPTY_FILM};
  let calls = 0;
  const states: {roll: string | null; strength: number}[] = [];
  const queue = createFilmSaveQueue(stored, async (patch) => {
    if (++calls === 1) return {ok: false, message: 'failed'};
    stored = applyFilmPatch(stored, patch);
    return {ok: true, data: stored};
  }, (state) => states.push(state));
  queue.enqueue({roll: 'velvia'});
  queue.enqueue({roll: 'acros', strength: 0.5});
  assert.equal(await queue.flush(), false);
  assert.deepEqual(queue.current(), stored);
  assert.equal(states.at(-1)!.roll, 'acros');
  queue.enqueue({strength: 0.8});
  assert.equal(await queue.flush(), true);
  assert.equal(stored.strength, 0.8);
});

test('queued photo edits capture their selected look even if the roll save fails', async () => {
  let stored = {...EMPTY_FILM};
  let calls = 0;
  const queue = createFilmSaveQueue(stored, async (patch) => {
    if (++calls === 1) throw new Error('offline');
    stored = applyFilmPatch(stored, patch);
    return {ok: true, data: stored};
  }, () => {});
  queue.enqueue({roll: 'velvia'});
  queue.enqueue({photo: {assetId: 'photo:a.jpg', strength: 0.4}});
  await queue.flush();
  assert.deepEqual(stored.photos['a.jpg'], {roll: 'velvia', strength: 0.4});
  assert.deepEqual(queue.current(), stored);
});

test('synchronous save failure drains and allows a later retry', async () => {
  let fail = true;
  const queue = createFilmSaveQueue(EMPTY_FILM, (patch) => {
    if (fail) throw new Error('offline');
    return Promise.resolve({ok: true, data: applyFilmPatch(EMPTY_FILM, patch)});
  }, () => {});
  queue.enqueue({roll: 'acros'});
  assert.equal(await queue.flush(), false);
  fail = false;
  queue.enqueue({roll: 'velvia'});
  assert.equal(await queue.flush(), true);
});


test('preview and export derive the same seed from a photo relative path', () => {
  for (const path of ['a.jpg', 'photos/海边.jpg', 'day 1/b.png']) {
    assert.equal(seedFor(`photo:${path}`), filmSeedFor(path));
  }
});


test('view cycle visits both compare orders and the complete effect', () => {
  const start = 'original-left';
  const reversed = nextFilmViewMode(start);
  const full = nextFilmViewMode(reversed);
  assert.equal(reversed, 'effect-left');
  assert.equal(full, 'effect');
  assert.equal(nextFilmViewMode(full), start);
  assert.deepEqual([start, reversed, full].map((mode) => filmViewAction(mode as 'original-left' | 'effect-left' | 'effect')), ['交换左右', '看完整效果', '开启对比']);
});

test('center swap synchronizes the next action without entering complete view', () => {
  const reversed = swapFilmViewMode('original-left');
  assert.equal(filmViewAction(reversed), '看完整效果');
  assert.equal(filmViewLabel(reversed), '左胶片、右原图');
  const restored = swapFilmViewMode(reversed);
  assert.equal(restored, 'original-left');
  assert.equal(filmViewAction(restored), '交换左右');
  assert.equal(swapFilmViewMode('effect'), 'effect');
});


test('thumbnail follow leaves the middle still and reveals upcoming photos near either edge', () => {
  const viewport = {scrollLeft: 200, viewportWidth: 800, scrollWidth: 2000, itemWidth: 74, gap: 6};
  assert.equal(photoStripTarget({...viewport, itemLeft: 500}), 200);
  assert.equal(photoStripTarget({...viewport, itemLeft: 900}), 334);
  assert.equal(photoStripTarget({...viewport, itemLeft: 250}), 90);
});

test('thumbnail follow clamps both ends and does not scroll a short strip', () => {
  const viewport = {scrollLeft: 0, viewportWidth: 358, scrollWidth: 1200, itemWidth: 74, gap: 6};
  assert.equal(photoStripTarget({...viewport, itemLeft: 0}), 0);
  assert.equal(photoStripTarget({...viewport, itemLeft: 1126}), 842);
  assert.equal(photoStripTarget({...viewport, scrollWidth: 240, itemLeft: 160}), 0);
  assert.equal(photoStripTarget({...viewport, viewportWidth: 0, itemLeft: 160}), 0);
});
