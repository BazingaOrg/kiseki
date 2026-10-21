import assert from 'node:assert/strict';
import test from 'node:test';
import {bakeLut, decodeLut, encodeLut, formatCube, getRoll, lutForRoll, parseCube, sampleLut} from '../src/index.mjs';

const identity = (r, g, b, out) => {
  out[0] = r;
  out[1] = g;
  out[2] = b;
  return out;
};

test('an identity LUT samples back its input', () => {
  const lut = bakeLut(identity, 9);
  const out = sampleLut(lut, 0.31, 0.62, 0.05, [0, 0, 0]);
  out.forEach((v, i) => assert.ok(Math.abs(v - [0.31, 0.62, 0.05][i]) < 1e-6));
});

test('.cube and compact encodings round-trip', () => {
  const lut = bakeLut((r, g, b, out) => identity(r * r, g, Math.sqrt(b), out), 5);
  const cube = parseCube(formatCube(lut, 't'));
  assert.equal(cube.size, 5);
  cube.data.forEach((v, i) => assert.ok(Math.abs(v - lut.data[i]) < 1e-5));
  const packed = decodeLut(encodeLut(lut));
  packed.data.forEach((v, i) => assert.ok(Math.abs(v - lut.data[i]) < 2e-5));
});

test('the fitted Classic Chrome LUT mutes a saturated sky', () => {
  const lut = lutForRoll(getRoll('classic-chrome'));
  assert.equal(lut.size, 17);
  const [r, g, b] = sampleLut(lut, 0.25, 0.55, 0.9, [0, 0, 0]);
  assert.ok(Math.max(r, g, b) - Math.min(r, g, b) < 0.65);
});
