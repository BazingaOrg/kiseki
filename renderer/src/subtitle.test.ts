import assert from 'node:assert/strict';
import test from 'node:test';

import {resolveFontFamily} from './fontFamily.ts';

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
