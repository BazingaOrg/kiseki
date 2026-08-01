import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

import {normalizeSearchQuery, searchLyrics} from './api.ts';

const source = (name: string) => readFile(new URL(`./${name}`, import.meta.url), 'utf8');

const lyricsSearchSource = (materials: string) => {
  const startMarker = 'const LyricsSearch =';
  const endMarker = '\n\ninterface LyricsFetchProps';
  const start = materials.indexOf(startMarker);
  const end = materials.indexOf(endMarker, start);
  assert.notEqual(start, -1, 'LyricsSearch start marker must exist');
  assert.notEqual(end, -1, 'LyricsSearch end marker must exist');
  return materials.slice(start, end);
};

test('search normalization trims and collapses whitespace without changing search syntax or order', () => {
  assert.equal(normalizeSearchQuery('  晴天   + 周杰伦 - live · remaster  '), '晴天 + 周杰伦 - live · remaster');
});

test('automatic lyric searches omit q, including repeated blank searches', async () => {
  const originalFetch = globalThis.fetch;
  const originalDocument = globalThis.document;
  const urls: string[] = [];
  Object.assign(globalThis, {
    document: {querySelector: () => null},
    fetch: async (url: string) => {
      urls.push(url);
      return {ok: true, json: async () => ({candidates: [], query: 'Song Artist'})};
    },
  });
  try {
    await searchLyrics('/project', '   ');
    await searchLyrics('/project', '');
    assert.deepEqual(urls, [
      '/api/fetch/lyrics-search?folder=%2Fproject',
      '/api/fetch/lyrics-search?folder=%2Fproject',
    ]);
  } finally {
    Object.assign(globalThis, {fetch: originalFetch, document: originalDocument});
  }
});

test('Materials keeps raw input and discards stale search results without writing inferred query into the input', async () => {
  const lyricsSearch = lyricsSearchSource(await source('Materials.tsx'));
  assert.match(lyricsSearch, /const querySnapshot = queryRef\.current;[\s\S]*?const normalized = normalizeSearchQuery\(querySnapshot\);/);
  assert.match(lyricsSearch, /const outcome = await searchLyrics\(project\.path, normalized\);/);
  assert.match(lyricsSearch, /generation !== searchGeneration\.current \|\| queryRef\.current !== querySnapshot/);
  assert.match(lyricsSearch, /onChange=\{\(event\) => \{[\s\S]*?searchGeneration\.current \+= 1;[\s\S]*?queryRef\.current = event\.target\.value;/);
  assert.doesNotMatch(lyricsSearch, /setQuery\(outcome\.data\.query\)/);
  assert.match(lyricsSearch, /placeholder="留空自动匹配；也可输入歌名 歌手"/);
  assert.match(lyricsSearch, /normalizeSearchQuery\(query\) \? '手动关键词' : '自动匹配'/);
});
