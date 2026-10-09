import assert from 'node:assert/strict';
import test from 'node:test';

import {SignatureError, renderSignatureSvg} from './signature-svg.mjs';
import {previewSignature} from './web-api/signature.mjs';

test('a latin name becomes stroked svg paths', () => {
  const svg = renderSignatureSvg(' Ada ');
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 688 228">/);
  assert.equal(svg.match(/<path /g)?.length, 3);
  assert.equal(svg.includes('transform='), false);
});

test('a chinese name uses the brush signature font', () => {
  const svg = renderSignatureSvg('张三');
  assert.equal(svg.match(/<path /g)?.length, 2);
  assert.match(svg, /viewBox="0 0 688 228"/);
});

test('missing glyphs and empty names are rejected', () => {
  assert.throws(() => renderSignatureSvg('🎉'), (error) => error instanceof SignatureError && /写不出这些字/.test(error.message));
  assert.throws(() => renderSignatureSvg('   '), (error) => error instanceof SignatureError && /先写一个名字/.test(error.message));
  assert.throws(() => renderSignatureSvg('a'.repeat(25)), /最长 24/);
});

test('preview returns the svg or a readable error', () => {
  const ok = previewSignature(JSON.stringify({name: 'Ada'}));
  assert.equal(ok.status, 200);
  assert.match(ok.body.svg, /^<svg /);
  const bad = previewSignature(JSON.stringify({name: ''}));
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /先写一个名字/);
  assert.equal(previewSignature('{').status, 400);
});
