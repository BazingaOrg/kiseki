import assert from 'node:assert/strict';
import test from 'node:test';
import {ROLLS, develop, getRoll} from '../src/index.mjs';
import {chart, flat} from './helpers.mjs';

test('every roll develops deterministically for a fixed seed', () => {
  const image = chart();
  for (const roll of ROLLS) {
    const a = develop(image, {roll: roll.id, seed: 3});
    const b = develop(image, {roll: roll.id, seed: 3});
    assert.deepEqual(a.data, b.data, roll.id);
    assert.equal(a.width, image.width);
  }
});

test('zero strength and unknown rolls leave pixels untouched', () => {
  const image = chart();
  assert.deepEqual(develop(image, {roll: 'portrait-400', strength: 0}).data, image.data);
  assert.deepEqual(develop(image, {roll: 'nope'}).data, image.data);
});

test('the source image is never mutated', () => {
  const image = chart();
  const copy = new Uint8ClampedArray(image.data);
  develop(image, {roll: 'night-800t', date: '2024-10-05'});
  assert.deepEqual(image.data, copy);
});

test('a photo already shot in the same look keeps its colors', () => {
  const image = flat(90, 140, 200);
  const sourceLook = {maker: 'fujifilm', label: '经典铬', roll: 'classic-chrome'};
  const out = develop(image, {roll: 'classic-chrome', sourceLook, grain: false});
  const center = ((16 * 32) + 16) * 4;
  assert.deepEqual([...out.data.subarray(center, center + 3)], [90, 140, 200]);
});

test('grain can be left out for video, where it is added per frame', () => {
  const image = flat(128, 128, 128);
  const out = develop(image, {roll: 'tri-x-400', grain: false});
  const values = new Set();
  for (let i = 0; i < out.data.length; i += 4) values.add(out.data[i]);
  assert.ok(values.size < 40);
  assert.ok(getRoll('tri-x-400').effects.grain > 0.4);
});

test('the disposable camera prints the shooting date', () => {
  const image = flat(40, 40, 40, 400, 300);
  const stamped = develop(image, {roll: 'disposable', grain: false, date: '2024-10-05T10:00:00'});
  const plain = develop(image, {roll: 'disposable', grain: false});
  let orange = 0;
  for (let i = 0; i < stamped.data.length; i += 4) {
    if (stamped.data[i] - plain.data[i] > 60 && stamped.data[i + 2] - plain.data[i + 2] < 40) orange++;
  }
  assert.ok(orange > 50);
});
