import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CAPTION_MAX_CODE_POINTS,
  SYSTEM_PROMPT,
  USER_PROMPT,
  normalizeCaption,
  promptHash,
  validateCaption,
} from './photo-caption-prompt.mjs';

test('prompt hash is stable for the current prompt version', () => {
  assert.equal(promptHash.length, 64);
  assert.match(SYSTEM_PROMPT, /电子相框/);
  assert.match(SYSTEM_PROMPT, /实际看得见/);
  assert.equal(USER_PROMPT, '请看着这张照片，写一句符合规则的中文旁白。');
});

test('validator accepts a 30-code-point sentence and rejects the 31st', () => {
  const ok = '坐得端正，也不耽误心里走神一二三四五六七八';
  assert.equal(validateCaption(ok).ok, true);
  assert.equal([...ok].length <= CAPTION_MAX_CODE_POINTS, true);
  assert.equal(validateCaption(ok).ok, true);
  const thirty = '一'.repeat(CAPTION_MAX_CODE_POINTS);
  assert.equal(validateCaption(thirty).ok, true);
  assert.equal(validateCaption(`${thirty}。`).ok, false);
  assert.equal(validateCaption(`${thirty}。`).reason, 'too-long');
});

test('validator counts unicode code points rather than UTF-16 length', () => {
  const withPunctuation = '今天出门，伞忘了带。';
  assert.equal(validateCaption(withPunctuation).ok, true);
  assert.equal([...normalizeCaption('  一句旁白  ')].length, 4);
});

test('validator rejects wrapping quotes, newlines, deixis and forbidden patterns', () => {
  assert.equal(validateCaption('"坐得端正"').reason, 'quoted');
  assert.equal(validateCaption('「坐得端正」').reason, 'quoted');
  assert.equal(validateCaption('第一行\n第二行').reason, 'newline');
  assert.equal(validateCaption('这张照片很安静').reason, 'photo-deixis');
  assert.equal(validateCaption('眼里装着整个世界').reason, 'world-in');
  assert.equal(validateCaption('心里装着整个夏天').reason, 'summer-in');
  assert.equal(validateCaption('笑得像风').reason, 'like');
  assert.equal(validateCaption('比昨天还轻').reason, 'more-than');
  assert.equal(validateCaption('走得比风更慢').reason, 'even-more');
  assert.equal(validateCaption('   ').reason, 'empty');
});
