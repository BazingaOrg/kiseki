import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

import {fetchLyricsPreview, normalizeSearchQuery, searchLyrics} from './api.ts';

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

test('lyric preview keeps provider and id together in its request', async () => {
  const originalFetch = globalThis.fetch;
  const originalDocument = globalThis.document;
  const urls: string[] = [];
  Object.assign(globalThis, {
    document: {querySelector: () => null},
    fetch: async (url: string) => {
      urls.push(url);
      return {ok: true, json: async () => ({lines: [], provider: 'amll', sourceName: 'AMLL', translationCount: 0, lineCount: 0})};
    },
  });
  try {
    await fetchLyricsPreview('/project', 'track / id', 'amll');
    await fetchLyricsPreview('/project', '12', 'amll', '12.ttml');
    assert.deepEqual(urls, [
      '/api/fetch/lyrics-preview?folder=%2Fproject&id=track+%2F+id&provider=amll',
      '/api/fetch/lyrics-preview?folder=%2Fproject&id=12&provider=amll&filename=12.ttml',
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
  assert.match(lyricsSearch, /placeholder="留空自动匹配，手动搜索优先只输入歌名"/);
  assert.match(lyricsSearch, /normalizeSearchQuery\(query\) \? '手动关键词' : '自动匹配'/);
  assert.match(lyricsSearch, /result\?\.ok && result\.data\.warnings\?\.map/);
});

test('Materials previews a selected source before validation and keys candidates by provider plus id', async () => {
  const materials = await source('Materials.tsx');
  const lyricsSearch = lyricsSearchSource(materials);
  assert.match(materials, /const lyricsCandidateKey = \(candidate: LyricsCandidate\) => `\$\{candidate\.provider \?\? 'lrclib'\}:\$\{candidate\.id\}`/);
  assert.match(lyricsSearch, /const outcome = await fetchLyricsPreview\(project\.path, candidate\.id, candidate\.provider, candidate\.filename\);/);
  assert.match(lyricsSearch, /const outcome = await validateLyrics\(project\.path, candidate\.id, candidate\.provider, candidate\.filename\);/);
  assert.match(lyricsSearch, /const outcome = await installLyrics\(project\.path, candidate\.id, candidate\.provider, offset, candidate\.filename\);/);
  assert.match(lyricsSearch, /generation !== previewGeneration\.current/);
  assert.match(lyricsSearch, /disabled=\{!preview \|\| locked \|\| validating !== null \|\| installing !== null\}/);
  assert.match(lyricsSearch, /含 \$\{preview\.translationCount\}\/\$\{preview\.lineCount\} 句中文译文，保存时会一起保存。/);
  assert.match(lyricsSearch, /此版本暂无中文译文，保存后将显示原文。/);
  assert.match(lyricsSearch, /candidate\.provider === 'amll' && <span className="fetch-warn">可能含中文译文<\/span>/);
});

test('Materials follow-along lyrics honor Make lyrics mode in the same tab', async () => {
  const [make, materials, lyrics] = await Promise.all([source('Make.tsx'), source('Materials.tsx'), source('Lyrics.tsx')]);
  assert.match(make, /localStorage\.setItem\(lyricsModeKey, next\.lyricsMode === 'original' \? 'original' : 'bilingual'\)/);
  assert.match(make, /window\.dispatchEvent\(new Event\(LYRICS_MODE_EVENT\)\)/);
  assert.match(materials, /const lyricsMode = useLyricsMode\(project\.path\)/);
  assert.match(materials, /<Lyrics lyrics=\{project\.lyrics!\} currentTime=\{state\.currentTime\} onSeek=\{seekTo\} mode=\{lyricsMode\} \/>/);
  assert.match(lyrics, /window\.addEventListener\('storage', sync\)/);
  assert.match(lyrics, /window\.addEventListener\(LYRICS_MODE_EVENT, sync\)/);
});

test('native folder picker releases its busy state when the dialog is cancelled', async () => {
  const folderPicker = await source('FolderPicker.tsx');
  assert.match(folderPicker, /const selected = await window\.kisekiDesktop\?\.openProject\(\);\s*if \(!selected\) \{ setSelecting\(false\); return; \}/);
});

test('native folder picker waits for host authorization instead of browsing an unavailable root', async () => {
  const folderPicker = await source('FolderPicker.tsx');
  assert.match(folderPicker, /runtime\.projectSelection === 'sandbox' && runtime\.root/);
  assert.match(folderPicker, /loadDirs\(runtime\.root\)/);
  assert.doesNotMatch(folderPicker, /loadDirs\('\.'\)/);
});

test('runtime recovery and every project selection share the App project request gate', async () => {
  const [app, folderPicker] = await Promise.all([source('App.tsx'), source('FolderPicker.tsx')]);
  assert.match(app, /const loadProject = useCallback[\s\S]*?const ticket = refreshGate\.begin\(\)/);
  assert.match(app, /data\.projectSelection === 'native' && data\.root[\s\S]*?loadProject\(data\.root\)/);
  assert.match(app, /onProjectChanged\(\(targetPath\)[\s\S]*?selectProject\(targetPath\)/);
  assert.match(app, /<FolderPicker runtime=\{runtime\} onProjectSelected=\{selectProject\}/);
  assert.match(app, /onInteractionStart=\{\(\) => setProjectLoadError\(null\)\}/);
  assert.match(folderPicker, /onInteractionStart\(\);[\s\S]*?setSelecting\(true\); setError\(null\);/);
  assert.match(folderPicker, /await onProjectSelected\(targetPath\)/);
  assert.doesNotMatch(folderPicker, /fetch\(`\/api\/project/);
});
