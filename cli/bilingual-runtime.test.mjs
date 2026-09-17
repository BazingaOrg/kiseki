import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {parseArgs} from './options.mjs';
import {buildJobArgv} from './job-argv.mjs';
import {resolveRenderOutputPath} from './output-naming.mjs';
import {applyRenderVariants} from './render.mjs';
import {validateTimeline} from './timeline-validator.mjs';
import {withGapEnds} from './web-api/project.mjs';
import {buildJobSpec} from './web-api/job-spec.mjs';
import {formatLyricsPreview} from './lyrics.mjs';
import {limitLyricsCandidates} from './fetch.mjs';
import {rankWebLyricsCandidates} from './web-api/fetch.mjs';

test('lyrics display choice survives CLI and job argument conversion', () => {
  for (const lyricsMode of ['original', 'bilingual']) {
    const argv = buildJobArgv({kind: 'render', folder: '/album', options: {lyricsMode}});
    assert.equal(parseArgs(argv).lyricsMode, lyricsMode);
  }
  assert.throws(() => parseArgs(['/album', '--lyrics-mode']), /lyrics-mode/);
  assert.throws(() => buildJobArgv({kind: 'render', folder: '/album', options: {lyricsMode: 'translated'}}), /lyricsMode/);
  assert.equal(buildJobArgv({kind: 'still', folder: '/album', options: {lyricsMode: 'original'}}).includes('--lyrics-mode'), false);
});

test('original-only exports do not overwrite the default bilingual export', () => {
  const original = resolveRenderOutputPath({folder: '/album', lyricsMode: 'original'});
  const bilingual = resolveRenderOutputPath({folder: '/album', lyricsMode: 'bilingual'});
  assert.notEqual(original, bilingual);
  assert.equal(bilingual, resolveRenderOutputPath({folder: '/album'}));
  const spec = buildJobSpec({kind: 'render', folder: '/album', options: {lyricsMode: 'original'}});
  assert.deepEqual(spec.outputPaths, [original]);
});

test('render variants preserve translations while only switching their presentation', async () => {
  const source = JSON.parse(fs.readFileSync(new URL('../examples/fixture/timeline.json', import.meta.url), 'utf8'));
  source.subtitles[0].translation = {text: '中文译文', lang: 'zh'};
  const result = await applyRenderVariants(structuredClone(source), {lyricsMode: 'original'}, {resolvePhotoPath: (src) => src});
  assert.equal(result.meta.lyrics_mode, 'original');
  assert.deepEqual(result.subtitles, source.subtitles);
  assert.equal(source.meta.lyrics_mode, undefined);
  assert.equal(validateTimeline(result), result);
  const invalid = structuredClone(source);
  invalid.subtitles[0].translation.lang = 'en';
  assert.throws(() => validateTimeline(invalid), /translation.lang/);
  await assert.rejects(() => applyRenderVariants(structuredClone(source), {lyricsMode: 'other'}), /lyrics-mode/);
});

test('project follow-along preserves the translation and gap end on a single entry', () => {
  const translation = {text: '译文', lang: 'zh'};
  assert.deepEqual(withGapEnds([{time: 1, text: 'Original', translation}, {time: 3, text: ''}]), [
    {time: 1, text: 'Original', translation, until: 3},
  ]);
});

test('CLI analyzed lyric preview keeps downloaded translation beneath the original', () => {
  const lines = formatLyricsPreview({backend: 'lrc', language: 'en', segments: [
    {text: 'Original', translation: {text: '已有译文', lang: 'zh'}, start: 1, end: 2, confidence: 1},
  ]});
  assert.match(lines[1].text, /Original/);
  assert.equal(lines[2].text.trim(), '已有译文');
});

test('both download surfaces retain an AMLL candidate when LRCLIB fills the result limit', () => {
  const originals = Array.from({length: 12}, (_, id) => ({
    id, trackName: 'Song', artistName: 'Artist', duration: 180, syncedLyrics: '[00:01.000]Original',
  }));
  const bilingual = {id: 0, provider: 'amll', trackName: 'Song', artistName: 'Artist', duration: null};
  const records = [...originals, bilingual];
  const cli = limitLyricsCandidates(records, 180);
  const web = rankWebLyricsCandidates(records, {audioDuration: 180, title: 'Song', artist: 'Artist'});
  assert.equal(cli.length, 10);
  assert.equal(web.length, 10);
  assert.equal(cli.at(-1), bilingual);
  assert.equal(web.at(-1).record, bilingual);
  assert.deepEqual(cli.slice(0, 9), originals.slice(0, 9));
});

test('AMLL without duration is not sorted behind a large LRCLIB duration mismatch', () => {
  const originals = Array.from({length: 12}, (_, id) => ({
    id, trackName: 'Song', artistName: 'Artist', duration: 200, syncedLyrics: '[00:01.000]Original',
  }));
  const bilingual = {id: 99, provider: 'amll', trackName: 'Song', artistName: 'Artist', duration: null};
  const records = [...originals, bilingual];
  const cli = limitLyricsCandidates(records, 180);
  const web = rankWebLyricsCandidates(records, {audioDuration: 180, title: 'Song', artist: 'Artist'});
  assert.equal(cli.length, 10);
  assert.equal(web.length, 10);
  assert.equal(cli[0], bilingual);
  assert.equal(web[0].record, bilingual);
  assert.ok(web.every(({record}) => record === bilingual || record.duration === 200));
});
