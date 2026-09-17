import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {DOMParser} from '@xmldom/xmldom';

import {normalizeAmllCandidate, parseAmllLyrics} from './amll.mjs';
import {parseLrc} from './lrc.mjs';

const ttml = `<?xml version="1.0"?><tt xmlns:ttm="urn:ttm" xmlns:itunes="urn:itunes" xmlns:amll="urn:amll"><head><metadata><amll:meta key="ttmlAuthorGithubLogin" value="writer"/></metadata></head><body><div><p begin="00:01.234" end="2s" itunes:key="L1"><span>君</span><span>の歌</span><span ttm:role="x-translation" xml:lang="zh-CN">你的歌</span><span ttm:role="x-roman" xml:lang="ja-Latn">kimi no uta</span><span ttm:role="x-bg">background</span></p><p begin="3s" end="4s" itunes:key="L2"></p></div></body></tt>`;

test('AMLL normalizes candidates and emits paired extended LRC', () => {
  assert.deepEqual(normalizeAmllCandidate({id: 7, musicName: 'Song', artists: 'Artist', albumName: 'Album'}), {
    id: '7', provider: 'amll', trackName: 'Song', artistName: 'Artist', albumName: 'Album', duration: null,
  });
  assert.equal(normalizeAmllCandidate({id: 7, filename: '7.ttml'}).filename, '7.ttml');
  const result = parseAmllLyrics({id: 7, musicName: 'Song', artists: 'Artist', albumName: 'Album', format: 'ttml', lyrics: ttml});
  assert.equal(result.lineCount, 1);
  assert.equal(result.translationCount, 1);
  assert.match(result.syncedLyrics, /\[kiseki:source:amll\]/);
  assert.deepEqual(parseLrc(result.syncedLyrics, {keepGaps: true}).at(0), {time: 1.234, text: '君の歌', translation: {text: '你的歌', lang: 'zh'}});
  assert.deepEqual(parseLrc(result.syncedLyrics, {keepGaps: true}).slice(-2), [{time: 3, text: ''}, {time: 4, text: ''}]);
});

test('AMLL reads header Chinese translation and rejects unsafe or ambiguous TTML', () => {
  const withHeader = `<?xml version="1.0"?><tt xmlns:itunes="urn:itunes"><head><metadata><iTunesMetadata><translations><translation xml:lang="zh-Hans-CN"><text for="L1">中文</text></translation></translations></iTunesMetadata></metadata></head><body><p begin="1s" end="2s" itunes:key="L1">English</p></body></tt>`;
  assert.equal(parseAmllLyrics({format: 'ttml', lyrics: withHeader}).translationCount, 1);
  assert.throws(() => parseAmllLyrics({format: 'ttml', lyrics: '<!DOCTYPE tt><tt><body><p begin="1s">x</p></body></tt>'}), /DTD/);
  const ambiguous = ttml.replace('</p>', '<span ttm:role="x-translation" xml:lang="zh-Hans">另一句</span></p>');
  assert.throws(() => parseAmllLyrics({format: 'ttml', lyrics: ambiguous}), /多个中文译文/);
});

test('AMLL preserves word boundaries, writes gaps from end, and rejects unsafe timelines', () => {
  const gaps = `<?xml version="1.0"?><tt xmlns:ttm="urn:ttm"><body><p begin="1s" end="2s">Hello <span>world</span></p><p begin="4s" end="5s">Again</p></body></tt>`;
  const result = parseAmllLyrics({format: 'ttml', lyrics: gaps});
  assert.match(result.syncedLyrics, /\[00:01\.000\]Hello world/);
  assert.match(result.syncedLyrics, /\[00:02\.000\]\n\[00:04\.000\]Again/);
  assert.match(result.syncedLyrics, /\[00:05\.000\]\n$/);
  const overlap = gaps.replace('begin="4s" end="5s"', 'begin="1.5s" end="5s"');
  assert.ok(parseAmllLyrics({format: 'ttml', lyrics: overlap}).warnings.includes('部分重叠歌词已在下一句开始时清屏'));
  const injected = gaps.replace('Again', '&#10;[00:00.000]injected');
  assert.throws(() => parseAmllLyrics({format: 'ttml', lyrics: injected}), /不能写入 LRC/);
  assert.throws(() => parseAmllLyrics({format: 'ttml', lyrics: '<tt><body><p begin="1s" end="2s">x</body></tt>'}), /无效/);
});

test('AMLL drops Chinese translation on empty original rows', () => {
  const emptyTranslated = '<?xml version="1.0"?><tt xmlns:ttm="urn:ttm" xmlns:itunes="urn:itunes"><head><metadata><iTunesMetadata><translations><translation xml:lang="zh-CN"><text for="L2">间奏</text></translation></translations></iTunesMetadata></metadata></head><body><p begin="1s" end="2s">Hello</p><p begin="2s" end="3s" itunes:key="L2"><span ttm:role="x-translation" xml:lang="zh-CN">间奏</span></p></body></tt>';
  const result = parseAmllLyrics({format: 'ttml', lyrics: emptyTranslated});
  assert.equal(result.lineCount, 1);
  assert.equal(result.translationCount, 0);
  assert.match(result.syncedLyrics, /\[00:02\.000\]\n/);
  assert.doesNotMatch(result.syncedLyrics, /\[kiseki:translation:zh-CN\]/);
  assert.deepEqual(parseLrc(result.syncedLyrics, {keepGaps: true}), [
    {time: 1, text: 'Hello'},
    {time: 2, text: ''},
    {time: 3, text: ''},
  ]);
  assert.ok(result.warnings.includes('部分歌词没有中文译文'));
  const fullyTranslated = '<?xml version="1.0"?><tt xmlns:ttm="urn:ttm"><body><p begin="1s" end="2s">Hello<span ttm:role="x-translation" xml:lang="zh-CN">你好</span></p><p begin="2s" end="3s"></p></body></tt>';
  const complete = parseAmllLyrics({format: 'ttml', lyrics: fullyTranslated});
  assert.equal(complete.lineCount, 1);
  assert.equal(complete.translationCount, 1);
  assert.equal(complete.warnings.includes('部分歌词没有中文译文'), false);
});

test('AMLL production samples parse without emitting their lyric text', {skip: !process.env.AMLL_SAMPLE_DIR}, () => {
  for (const filename of ['amll-lemon.json', 'amll-shape.json']) {
    const record = JSON.parse(readFileSync(`${process.env.AMLL_SAMPLE_DIR}/${filename}`, 'utf8'));
    const result = parseAmllLyrics(record.data);
    assert.ok(result.lineCount > 0);
    assert.ok(result.syncedLyrics.split(/\r?\n/).filter((line) => /^\[\d+:\d+\.\d{3}\]$/.test(line)).length > 0);
    const source = new DOMParser().parseFromString(record.data.lyrics, 'application/xml');
    const expected = Array.from(source.getElementsByTagName('p')).map((paragraph) => {
      const copy = paragraph.cloneNode(true);
      for (const span of Array.from(copy.getElementsByTagName('span'))) {
        const currentRole = span.getAttribute('ttm:role') || span.getAttribute('role');
        if (['x-translation', 'x-roman', 'x-bg'].includes(currentRole)) span.parentNode.removeChild(span);
      }
      return copy.textContent.replace(/\s+/g, ' ').trim();
    }).filter(Boolean);
    assert.deepEqual(parseLrc(result.syncedLyrics).map((entry) => entry.text), expected);
  }
});
