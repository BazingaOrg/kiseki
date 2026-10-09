import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CAPTION_MAX_CODE_POINTS,
  SYSTEM_PROMPT,
  USER_PROMPT,
  normalizeCaption,
  normalizeCaptionHint,
  promptHash,
  repairUserPrompt,
  userPromptWithHint,
  validateCaption,
} from './photo-caption-prompt.mjs';

test('prompt hash is stable for the current prompt version', () => {
  assert.equal(promptHash.length, 64);
  assert.match(SYSTEM_PROMPT, /电子相框/);
  assert.match(SYSTEM_PROMPT, /实际看得见/);
  assert.equal(USER_PROMPT, '请看着这张照片，写一句符合规则的中文旁白。');
});

test('validator accepts the maximum length and rejects the next code point', () => {
  const max = '一'.repeat(CAPTION_MAX_CODE_POINTS);
  assert.equal(validateCaption(max).ok, true);
  assert.equal(validateCaption(`${max}。`).reason, 'too-long');
});

test('validator counts unicode code points and normalizes surrounding whitespace', () => {
  assert.equal(validateCaption('今天出门，伞忘了带。').ok, true);
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

test('caption hints collapse whitespace and cap length without changing the default prompt', () => {
  assert.equal(normalizeCaptionHint('  妈妈  在左边  '), '妈妈 在左边');
  assert.equal([...normalizeCaptionHint('一'.repeat(50))].length, 40);
  assert.equal(userPromptWithHint(''), USER_PROMPT);
  assert.match(userPromptWithHint('这是外婆'), /拍摄者补充/);
  assert.match(userPromptWithHint('这是外婆'), /这是外婆/);
  assert.match(repairUserPrompt('too-long', '这是外婆'), /这是外婆/);
});
