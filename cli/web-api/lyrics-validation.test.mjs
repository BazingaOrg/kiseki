import assert from 'node:assert/strict';
import test from 'node:test';

import {shiftLrc, validateLyricsAlignment} from './lyrics-validation.mjs';

const lrc = [
  {time: 10, text: '还记得昨天那个夏天'},
  {time: 20, text: '微风吹过的一瞬间'},
  {time: 30, text: '似乎吹翻一切'},
  {time: 40, text: '只剩寂寞跟沉淀'},
];

test('stable offsets are recommended for correction', () => {
  const recognized = lrc.map((entry, index) => ({start: entry.time + 6.8 + index * 0.1, text: entry.text}));
  const result = validateLyricsAlignment(recognized, lrc);
  assert.equal(result.status, 'offset');
  assert.ok(Math.abs(result.recommendedOffset - 6.95) < 0.01);
});

test('growing offsets are treated as a different version', () => {
  const recognized = lrc.map((entry, index) => ({start: entry.time + 6 + index * 3, text: entry.text}));
  assert.equal(validateLyricsAlignment(recognized, lrc).status, 'mismatch');
});

test('too few text anchors remain inconclusive', () => {
  assert.equal(validateLyricsAlignment([{start: 12, text: lrc[0].text}], lrc).status, 'inconclusive');
});

test('boundary jitter without a sustained trend is not a version mismatch', () => {
  const extended = Array.from({length: 9}, (_, index) => ({time: index * 10 + 10, text: `第${index}句歌词内容`}));
  const jitter = [3, 8, 1, 5, 2, 7, 4, 6, 3];
  const recognized = extended.map((entry, index) => ({start: entry.time + jitter[index], text: entry.text}));
  assert.notEqual(validateLyricsAlignment(recognized, extended).status, 'mismatch');
});

test('repeated chorus matches the nearby occurrence instead of a later repeat', () => {
  const repeated = [
    {time: 20, text: '主歌第一句'}, {time: 30, text: '蓝色的思念'},
    {time: 80, text: '主歌第二句'}, {time: 90, text: '蓝色的思念'},
    {time: 140, text: '主歌第三句'}, {time: 150, text: '蓝色的思念'},
  ];
  const recognized = repeated.map((entry) => ({start: entry.time + 4, text: entry.text}));
  const result = validateLyricsAlignment(recognized, repeated);
  assert.equal(result.status, 'offset');
  assert.deepEqual(result.anchors.map(({offset}) => offset), [4, 4, 4, 4, 4, 4]);
});

test('shiftLrc preserves text and clamps timestamps at zero', () => {
  assert.equal(shiftLrc('[00:01.00]A\n[01:02.50]B', -2), '[00:00.00]A\n[01:00.50]B');
});
