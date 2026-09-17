import assert from 'node:assert/strict';
import test from 'node:test';

import {detectLyricsScript, formatLrcPageTitle, formatLrcPreview, parseLrc, preferSimplifiedChineseLrc} from './lrc.mjs';

test('parseLrc reads timestamps, skips metadata, and sorts by time', () => {
  const lrc = '[ti:晴天]\n[00:32.10]第二句\n[00:27.5]第一句\n[01:00.00][02:00.00]重复句\n[00:40.00]\n';
  assert.deepEqual(parseLrc(lrc), [
    {time: 27.5, text: '第一句'},
    {time: 32.1, text: '第二句'},
    {time: 60, text: '重复句'},
    {time: 120, text: '重复句'},
  ]);
});

test('formatLrcPreview pages through all lyrics without truncating rows', () => {
  const entries = Array.from({length: 15}, (_, i) => ({time: i * 10, text: `行${i}`}));
  const lines = formatLrcPreview(entries, {offset: 3, limit: 3});
  assert.deepEqual(lines, ['[00:30.0] 行3', '[00:40.0] 行4', '[00:50.0] 行5']);
  assert.equal(formatLrcPageTitle(15, 3, 3), '歌词预览 4-6/共 15 行');
  assert.equal(formatLrcPreview(entries.slice(0, 2)).length, 2);
});

test('traditional Chinese LRCLIB lyrics are converted to simplified Chinese', async () => {
  const source = '[ar:周傑倫]\n[00:01.00]故事的小黃花\n[00:02.00]從出生那年就飄著\n[00:03.00]為妳翹課';
  assert.equal(detectLyricsScript(source), 'zh');
  assert.deepEqual(await preferSimplifiedChineseLrc(source), {
    lyrics: '[ar:周杰伦]\n[00:01.00]故事的小黄花\n[00:02.00]从出生那年就飘着\n[00:03.00]为你翘课',
    script: 'zh',
    converted: true,
  });
});

test('already-simplified Chinese lyrics remain unchanged', async () => {
  const source = '[00:01.00]故事的小黄花\n[00:02.00]从出生那年就飘着';
  assert.deepEqual(await preferSimplifiedChineseLrc(source), {
    lyrics: source,
    script: 'zh',
    converted: false,
  });
});

test('English and Japanese lyrics bypass Chinese conversion', async () => {
  const english = '[00:01.00]Come along with me';
  const japanese = '[00:01.00]晴れた空に君を思う';
  assert.deepEqual(await preferSimplifiedChineseLrc(english), {
    lyrics: english,
    script: 'other',
    converted: false,
  });
  assert.deepEqual(await preferSimplifiedChineseLrc(japanese), {
    lyrics: japanese,
    script: 'ja',
    converted: false,
  });
});

test('parseLrc attaches Chinese translation to its original without creating another active row', () => {
  const source = '[00:01.234]君の歌\n[00:01.234][kiseki:translation:zh-CN]你的歌\n[00:03.000]\n';
  assert.deepEqual(parseLrc(source, {keepGaps: true}), [
    {time: 1.234, text: '君の歌', translation: {text: '你的歌', lang: 'zh'}},
    {time: 3, text: ''},
  ]);
});

test('formatLrcPreview prints the paired Chinese translation below its original', () => {
  assert.deepEqual(formatLrcPreview([{time: 1.234, text: '君の歌', translation: {text: '你的歌', lang: 'zh'}}]), [
    '[00:01.2] 君の歌',
    '       你的歌',
  ]);
});

test('preferSimplifiedChineseLrc preserves Japanese originals and converts only translation', async () => {
  const source = '[00:01.00]君と見た空\n[00:01.00][kiseki:translation:zh-CN]與妳看過的天空';
  const result = await preferSimplifiedChineseLrc(source);
  assert.equal(result.script, 'ja');
  assert.equal(result.lyrics, '[00:01.00]君と見た空\n[00:01.00][kiseki:translation:zh-CN]与你看过的天空');
});

test('extended LRC applies offset and rejects invalid translation pairings', () => {
  const shifted = '[offset:+500]\n[00:01.000]原文\n[00:01.000][kiseki:translation:zh-CN]译文';
  assert.deepEqual(parseLrc(shifted), [{time: 1.5, text: '原文', translation: {text: '译文', lang: 'zh'}}]);
  assert.throws(() => parseLrc('[00:01.00][kiseki:translation:zh-CN]孤儿'), /没有对应原文/);
  assert.throws(() => parseLrc('[00:01.00]One\n[00:01.00][kiseki:translation:zh-CN]一\n[00:01.00][kiseki:translation:zh-CN]二'), /不同中文译文/);
});
