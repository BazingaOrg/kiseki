import assert from 'node:assert/strict';
import test from 'node:test';

import {DEFAULT_OUTRO_TEXT, applyBrandingOverrides, effectiveOutroText} from './branding.mjs';

test('an omitted outro stays the renderer line, an explicit empty string hides it', () => {
  assert.equal(effectiveOutroText(new Set(), {outro_text: ''}), DEFAULT_OUTRO_TEXT);
  assert.equal(effectiveOutroText(new Set(['outro_text']), {outro_text: ''}), '');
  assert.equal(effectiveOutroText(new Set(['outro_text']), {outro_text: '谢谢观看'}), '谢谢观看');
});

test('render overrides set the outro and keep a short silent video long enough for the intro', () => {
  const timeline = {
    meta: {duration: 4, audio: '', branding: {intro: false}},
    photos: [{kind: 'photo', src: './a.jpg', start: 0, end: 4}],
  };
  applyBrandingOverrides(timeline, {
    outroText: '  再见  ',
    signature: 'output/metadata/generated-signature.svg',
  });
  assert.equal(timeline.meta.branding.outro_text, '再见');
  assert.equal(timeline.meta.branding.signature, 'output/metadata/generated-signature.svg');
  assert.equal(timeline.meta.branding.intro, true);
  assert.equal(timeline.meta.duration, 5.95);
  assert.equal(timeline.photos[0].end, 5.95);
});

test('a long timeline keeps its duration when a signature is attached', () => {
  const timeline = {
    meta: {duration: 8, audio: ''},
    photos: [{src: 'a.jpg', start: 0, end: 4}, {src: 'b.jpg', start: 4, end: 8}],
  };
  applyBrandingOverrides(timeline, {signature: './output/metadata/generated-signature.svg'});
  assert.equal(timeline.meta.duration, 8);
  assert.equal(timeline.photos[1].end, 8);
  assert.equal(timeline.meta.branding.intro, true);
});

test('outro and signature paths are rejected when they cannot be rendered', () => {
  assert.throws(() => applyBrandingOverrides({meta: {}, photos: []}, {outroText: 'a\nb'}), /不能换行/);
  assert.throws(() => applyBrandingOverrides({meta: {}, photos: []}, {signature: '../secret.svg'}), /素材夹/);
});
