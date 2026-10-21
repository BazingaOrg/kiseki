import assert from 'node:assert/strict';
import test from 'node:test';
import {detectSourceLook, effectiveStrength} from '../src/index.mjs';

const fujiNote = (tags) => {
  const ifd = 12;
  const bytes = new Uint8Array(ifd + 2 + tags.length * 12 + 4);
  const view = new DataView(bytes.buffer);
  bytes.set([...'FUJIFILM'].map((c) => c.charCodeAt(0)));
  view.setUint32(8, ifd, true);
  view.setUint16(ifd, tags.length, true);
  tags.forEach(([tag, value], i) => {
    const o = ifd + 2 + i * 12;
    view.setUint16(o, tag, true);
    view.setUint16(o + 2, 3, true);
    view.setUint32(o + 4, 1, true);
    view.setUint16(o + 8, value, true);
  });
  return bytes;
};

test('reads Classic Chrome from a Fujifilm maker note', () => {
  assert.deepEqual(detectSourceLook(fujiNote([[0x1003, 0x100], [0x1401, 0x600]])), {maker: 'fujifilm', label: '经典铬', roll: 'classic-chrome'});
});

test('monochrome saturation modes win over the film mode', () => {
  assert.equal(detectSourceLook(fujiNote([[0x1003, 0x500], [0x1401, 0x000]])).roll, 'acros');
});

test('standard Provia and foreign maker notes count as unstyled', () => {
  assert.equal(detectSourceLook(fujiNote([[0x1401, 0x000]])), null);
  assert.equal(detectSourceLook(new Uint8Array([1, 2, 3])), null);
  assert.equal(detectSourceLook(null), null);
});

test('same look skips color, a different look is softened', () => {
  const cc = {maker: 'fujifilm', label: '经典铬', roll: 'classic-chrome'};
  assert.deepEqual(effectiveStrength('classic-chrome', 1, cc), {color: 0, effects: 1, reason: 'same'});
  assert.deepEqual(effectiveStrength('portrait-400', 1, cc), {color: 0.6, effects: 1, reason: 'styled'});
  assert.deepEqual(effectiveStrength('portrait-400', 0.8, null), {color: 0.8, effects: 0.8, reason: null});
});
