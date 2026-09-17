import assert from 'node:assert/strict';
import test from 'node:test';

import {resolveFontFamily} from './fontFamily.ts';
import {assertSubtitleSafeHeight, fitSubtitleFontSize, hasTranslation, resolveBilingualMode, subtitleBlockHeight, subtitleVisibilityEnd} from './subtitleLayout.ts';

test('resolveFontFamily routes by script within the serif family by default', () => {
  assert.match(resolveFontFamily('hello', 'en'), /Noto Serif/);
  assert.match(resolveFontFamily('你好', 'zh'), /Noto Serif SC/);
  assert.match(resolveFontFamily('こんにちは', 'ja'), /Noto Serif JP/);
});

test('resolveFontFamily switches the whole family stack to sans', () => {
  assert.match(resolveFontFamily('hello', 'en', 'sans'), /Noto Sans/);
  assert.match(resolveFontFamily('你好', 'zh', 'sans'), /Noto Sans SC/);
  assert.match(resolveFontFamily('こんにちは', 'ja', 'sans'), /Noto Sans JP/);
  assert.doesNotMatch(resolveFontFamily('你好', 'zh', 'sans'), /Serif/);
});

test('bilingual subtitles reserve a second line and infer the display mode from downloaded translations', () => {
  const original = {text: 'hello', lang: 'en' as const, start: 0, end: 1, confidence: 1};
  const bilingual = {...original, translation: {text: '你好', lang: 'zh' as const}};
  assert.equal(hasTranslation(original), false);
  assert.equal(hasTranslation(bilingual), true);
  assert.equal(resolveBilingualMode(undefined, [original]), false);
  assert.equal(resolveBilingualMode(undefined, [bilingual]), true);
  assert.equal(resolveBilingualMode('original', [bilingual]), false);
  assert.equal(resolveBilingualMode('bilingual', [original]), false);
  assert.equal(subtitleBlockHeight({fontSize: 30, bilingual: false, scale: 1}), 30);
  assert.equal(subtitleBlockHeight({fontSize: 30, bilingual: true, scale: 1}), 70.8);
});

test('subtitle fitting refuses text that would need an unreadable shrink', () => {
  assert.equal(fitSubtitleFontSize({text: 'hello', fontSize: 30, letterSpacing: '0em', maxWidth: 500}), 30);
  assert.equal(fitSubtitleFontSize({text: 'WWW', fontSize: 30, letterSpacing: '0em', maxWidth: 100, measuredWidth: 120}), 25);
  assert.throws(
    () => fitSubtitleFontSize({text: '这是一个非常非常非常非常非常非常非常非常非常非常非常长的歌词句子', fontSize: 30, letterSpacing: '0em', maxWidth: 100}),
    /字幕过长/,
  );
  assert.equal(
    fitSubtitleFontSize({text: '这是一个非常非常非常非常非常非常非常非常非常非常非常长的歌词句子', fontSize: 30, letterSpacing: '0em', maxWidth: 100, enforceMinimum: false}) < 30,
    true,
  );
});

test('bilingual block must fit inside the supplied safe subtitle band', () => {
  assert.doesNotThrow(() => assertSubtitleSafeHeight({blockHeight: 70.8, bandBottomFromBottom: 0, bandTopFromBottom: 108, riseDown: 0, riseUp: 0, bilingual: true}));
  assert.throws(
    () => assertSubtitleSafeHeight({blockHeight: 70.8, bandBottomFromBottom: 97, bandTopFromBottom: 150, riseDown: 6, riseUp: 0, bilingual: true}),
    /安全区不足/,
  );
});

test('bilingual adjacent lines do not share a fade-out window, including a missing translation', () => {
  const first = {text: 'first', lang: 'en' as const, translation: {text: '第一句', lang: 'zh' as const}, start: 0, end: 1, confidence: 1};
  const second = {text: 'second', lang: 'en' as const, start: 1, end: 2, confidence: 1};
  assert.equal(subtitleVisibilityEnd({line: first, nextLine: second, fadeOutDuration: 0.25, bilingual: true}), 1);
  assert.equal(subtitleVisibilityEnd({line: first, nextLine: second, fadeOutDuration: 0.25, bilingual: false}), 1.25);
});
