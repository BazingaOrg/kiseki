import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {applyRenderVariants, detectParallelism, readFilmFlags, formatRenderDiagnostics, resolveCaptureSettings, resolveRenderSettings} from './render.mjs';
import {CACHE_VERSION} from './ai/photo-caption-cache.mjs';
import {filmSeedFor, filmSettingsPathFor, writeFilmSettings} from './film-settings.mjs';
import {CAPTION_MODEL, PROMPT_VERSION, promptHash} from './ai/photo-caption-prompt.mjs';
import {PREVIEW_WIDTH, readSourceStat, sourceIdentityRecord} from './image-identity.mjs';

const timeline = () => ({
  meta: {duration: 10, audio: './song.mp3'},
  photos: [
    {src: 'a.jpg', start: 0},
    {src: 'b.jpg', start: 1},
    {src: 'a.jpg', start: 2},
  ],
  subtitles: [],
});

test('no flags leaves the timeline untouched', async () => {
  const tl = timeline();
  const result = await applyRenderVariants(tl, {}, {resolvePhotoPath: (src) => src});
  assert.equal(result.meta.background, undefined);
  assert.equal(result.meta.sign, undefined);
  assert.equal(result.meta.templateId, undefined);
  assert.equal(result.photos[0].exif, undefined);
});

test('existing-caption rendering includes only valid cached photos without requiring every photo to have one', async () => {
  const folder = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kiseki-render-captions-')));
  try {
    const first = path.join(folder, 'a.jpg');
    fs.writeFileSync(first, 'image');
    fs.writeFileSync(path.join(folder, 'b.jpg'), 'image');
    const cachePath = path.join(folder, 'output', 'metadata', 'ai-captions.json');
    fs.mkdirSync(path.dirname(cachePath), {recursive: true});
    fs.writeFileSync(cachePath, JSON.stringify({
      version: CACHE_VERSION,
      model: CAPTION_MODEL,
      prompt_hash: promptHash,
      prompt_version: PROMPT_VERSION,
      revision: 1,
      items: {'a.jpg': {text: '已有旁白', source_identity: sourceIdentityRecord('a.jpg', readSourceStat(first), PREVIEW_WIDTH), preview_sha256: 'a'.repeat(64)}},
    }));
    const result = await applyRenderVariants({meta: {duration: 2, audio: null}, photos: [
      {kind: 'photo', src: './a.jpg', start: 0, end: 1},
      {kind: 'photo', src: './b.jpg', start: 1, end: 2},
    ], subtitles: []}, {photoCaption: true}, {publicDir: folder, resolvePhotoPath: (src) => path.join(folder, src)});
    assert.equal(result.photos[0].caption, '已有旁白');
    assert.equal(result.photos[1].caption, undefined);
    assert.deepEqual(result._captionSources.map(({key}) => key), ['a.jpg']);
  } finally {
    fs.rmSync(folder, {recursive: true, force: true});
  }
});

test('template flag injects templateId into meta', async () => {
  const result = await applyRenderVariants(timeline(), {template: 'slow-cinema'}, {resolvePhotoPath: (src) => src});
  assert.equal(result.meta.templateId, 'slow-cinema');
  // 无模板时 meta 不带 templateId,渲染器回退现有常量
  const plain = await applyRenderVariants(timeline(), {}, {resolvePhotoPath: (src) => src});
  assert.equal(plain.meta.templateId, undefined);
});

test('dark sets meta.background to black', async () => {
  const result = await applyRenderVariants(timeline(), {dark: true}, {resolvePhotoPath: (src) => src});
  assert.equal(result.meta.background, '#000000');
});

test('portrait and square override render props without changing the source timeline', async () => {
  const source = {...timeline(), meta: {...timeline().meta, width: 3000, height: 2000}};
  const portrait = await applyRenderVariants(structuredClone(source), {portrait: true}, {resolvePhotoPath: (src) => src});
  const square = await applyRenderVariants(structuredClone(source), {square: true}, {resolvePhotoPath: (src) => src});
  assert.deepEqual([portrait.meta.width, portrait.meta.height], [1080, 1920]);
  assert.deepEqual([square.meta.width, square.meta.height], [1080, 1080]);
  assert.deepEqual([source.meta.width, source.meta.height], [3000, 2000]);
  await assert.rejects(() => applyRenderVariants(timeline(), {portrait: true, square: true}), /不能同时使用/);
});

test('outro text and a signature are applied in memory and a short video grows enough for the intro', async () => {
  const source = {
    meta: {duration: 4, audio: '', branding: {intro: false}},
    photos: [{src: 'a.jpg', start: 0, end: 4}],
    subtitles: [],
  };
  const result = await applyRenderVariants(source, {
    outroText: '  再见  ',
    signature: 'output/metadata/generated-signature.svg',
  }, {resolvePhotoPath: (src) => src});
  assert.equal(result.meta.branding.outro_text, '再见');
  assert.equal(result.meta.branding.signature, 'output/metadata/generated-signature.svg');
  assert.equal(result.meta.branding.intro, true);
  assert.equal(result.meta.duration, 5.95);
  assert.equal(result.photos[0].end, 5.95);
  await assert.rejects(
    () => applyRenderVariants(timeline(), {signature: '../secret.svg'}, {resolvePhotoPath: (src) => src}),
    /素材夹/,
  );
});

test('song credit is injected for the outro and stays off the outro text', async () => {
  const result = await applyRenderVariants(timeline(), {}, {
    resolvePhotoPath: (src) => src,
    publicDir: '/album',
    audioExists: () => true,
    probeAudio: () => ({title: '晴天', artist: '周杰伦'}),
  });
  assert.equal(result.meta.audio_credit, '晴天 · 周杰伦');
  assert.equal(result.meta.branding, undefined);
  const silent = timeline();
  silent.meta.audio = '';
  const quiet = await applyRenderVariants(silent, {}, {
    resolvePhotoPath: (src) => src,
    publicDir: '/album',
    audioExists: () => true,
    probeAudio: () => ({title: '晴天', artist: '周杰伦'}),
  });
  assert.equal(quiet.meta.audio_credit, undefined);
});

test('sign sets meta.sign to true', async () => {
  const result = await applyRenderVariants(timeline(), {sign: true}, {resolvePhotoPath: (src) => src});
  assert.equal(result.meta.sign, true);
});

test('exif extracts once per unique src and attaches to every matching clip', async () => {
  const calls = [];
  const extractExif = async (absPath) => {
    calls.push(absPath);
    return absPath.includes('a.jpg') ? {camera: 'Test Camera'} : null;
  };
  const result = await applyRenderVariants(
    timeline(),
    {exif: true},
    {resolvePhotoPath: (src) => `/public/${src}`, extractExif},
  );
  assert.deepEqual(calls, ['/public/a.jpg', '/public/b.jpg']);
  assert.deepEqual(result.photos[0].exif, {camera: 'Test Camera'});
  assert.equal(result.photos[1].exif, null);
  assert.deepEqual(result.photos[2].exif, {camera: 'Test Camera'});
});

test('exif extraction uses bounded parallel batches for a larger album', async () => {
  let active = 0;
  let maximum = 0;
  const photos = Array.from({length: 17}, (_, index) => ({src: `${index}.jpg`, start: index}));
  const result = await applyRenderVariants({...timeline(), photos}, {exif: true}, {
    resolvePhotoPath: (src) => src,
    extractExif: async (src) => {
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active -= 1;
      return {camera: src};
    },
  });
  assert.equal(maximum, 8);
  assert.deepEqual(result.photos.map((photo) => photo.exif.camera), photos.map((photo) => photo.src));
});

test('exif shortage is reported once with the count of unique photos missing EXIF', async () => {
  let shortageCount = null;
  const extractExif = async () => null;
  await applyRenderVariants(
    timeline(),
    {exif: true},
    {
      resolvePhotoPath: (src) => src,
      extractExif,
      onExifShortage: (count) => { shortageCount = count; },
    },
  );
  assert.equal(shortageCount, 2);
});

test('legacy and explicit photo clips receive EXIF, while chapter and unknown clips are untouched', async () => {
  const tl = {
    ...timeline(),
    photos: [
      {src: 'legacy.jpg', start: 0},
      {kind: 'photo', src: 'photo.jpg', start: 1},
      {kind: 'chapter', text: '7月14日 · 第2天 ♪', start: 2, end: 4, src: 'not-a-photo.jpg'},
      {kind: 'future', src: 'unknown.jpg', start: 4, end: 5},
    ],
  };
  const calls = [];
  let shortageCount = null;
  const result = await applyRenderVariants(tl, {exif: true}, {
    resolvePhotoPath: (src) => src,
    extractExif: async (src) => { calls.push(src); return {camera: src}; },
    onExifShortage: (count) => { shortageCount = count; },
  });
  assert.deepEqual(calls, ['legacy.jpg', 'photo.jpg']);
  assert.deepEqual(result.photos[0].exif, {camera: 'legacy.jpg'});
  assert.deepEqual(result.photos[1].exif, {camera: 'photo.jpg'});
  assert.equal(result.photos[2].exif, undefined);
  assert.equal(result.photos[3].exif, undefined);
  assert.equal(shortageCount, null);
});

test('Diary clears a photo fade-out before a chapter and keeps lyrics above it', () => {
  const diary = fs.readFileSync(new URL('../renderer/src/Diary.tsx', import.meta.url), 'utf8');
  assert.match(diary, /const visualClips = photos\.filter\(\(clip\) => isPhotoClip\(clip\) \|\| isChapterClip\(clip\)\);/);
  assert.match(diary, /const isPhotoClip = \(clip: VisualClip \| undefined\)/);
  assert.match(diary, /fitPhotoTransition\(template\.transition \?\? nextClip\.transition, nextClip\.end - nextClip\.start\)/);
  assert.match(diary, /t <= coverUntil\(nextTransition, clip\.end\)/);
  assert.match(diary, /typeof clip\.src === 'string'/);
  assert.ok(diary.indexOf('<ChapterCard') < diary.indexOf('<Subtitle'));
});

test('normal and draft render settings preserve fps while changing transfer and encode quality', () => {
  assert.deepEqual(resolveRenderSettings({parallelism: 10}), {
    // 默认一半核心:这是本地工具,渲染时用户多半还在用这台机器
    concurrency: 5,
    scale: 1,
    crf: 16,
    jpegQuality: 90,
  });
  assert.deepEqual(resolveRenderSettings({draft: true, parallelism: 10}), {
    concurrency: 5,
    scale: 2 / 3,
    crf: 23,
    jpegQuality: 80,
  });
});

test('formal renders use reduced capture concurrency unless it is explicitly set', () => {
  assert.equal(resolveCaptureSettings({parallelism: 10, envConcurrency: ''}).concurrency, 1);
  assert.equal(resolveCaptureSettings({draft: true, parallelism: 10, envConcurrency: ''}).concurrency, 5);
  assert.equal(resolveCaptureSettings({parallelism: 10, envConcurrency: '3'}).concurrency, 3);
});

test('render diagnostics use the final composition and effective concurrency', () => {
  assert.equal(
    formatRenderDiagnostics({
      draft: true,
      composition: {width: 1280, height: 720, fps: 60, durationInFrames: 1440},
      renderSettings: {concurrency: 5},
      speed: 'full',
    }),
    '实际渲染配置:草稿;1280×720;60 fps;1440 帧;concurrency 5;速度档位 full',
  );
});

test('render concurrency supports explicit integer and percentage escape hatches', () => {
  assert.equal(resolveRenderSettings({parallelism: 1}).concurrency, 1);
  assert.equal(resolveRenderSettings({parallelism: 2}).concurrency, 1);
  assert.equal(resolveRenderSettings({parallelism: 16}).concurrency, 8);
  assert.equal(resolveRenderSettings({parallelism: 10, envConcurrency: '3'}).concurrency, 3);
  assert.equal(resolveRenderSettings({parallelism: 10, envConcurrency: '50%'}).concurrency, 5);
  assert.equal(resolveRenderSettings({parallelism: 10, envConcurrency: '1%'}).concurrency, 1);
  for (const value of ['0', '0%', '101%', 'half']) {
    assert.throws(() => resolveRenderSettings({envConcurrency: value}), /KISEKI_CONCURRENCY/);
  }
  assert.throws(
    () => resolveRenderSettings({parallelism: 2, envConcurrency: '3'}),
    /不能超过可用 CPU 数 2/,
  );
});

test('render parallelism respects container CPU quotas when Node exposes them', () => {
  assert.equal(detectParallelism({availableParallelism: () => 2, cpus: () => Array(64)}), 2);
  assert.equal(detectParallelism({cpus: () => Array(4)}), 4);
});

const filmSource = async (absPath) => ({
  sourceLook: absPath.endsWith('a.jpg') ? {maker: 'fujifilm', label: '经典铬', roll: 'classic-chrome'} : null,
  date: '2026-10-02',
});

test('film settings attach a resolved film to every photo clip that has a roll', async () => {
  const calls = [];
  const tl = timeline();
  tl.photos.push({kind: 'chapter', text: 'Day 2', start: 3}, {src: 'c.jpg', start: 4, film: {roll: 'velvia'}});
  const result = await applyRenderVariants(tl, {}, {
    resolvePhotoPath: (src) => `/public/${src}`,
    readFilm: () => ({version: 1, roll: 'classic-chrome', strength: 0.7, photos: {'b.jpg': {roll: 'velvia', strength: 0.4}, 'c.jpg': {roll: null, strength: 1}}}),
    extractFilmSource: async (absPath) => {
      calls.push(absPath);
      return filmSource(absPath);
    },
  });
  assert.deepEqual(calls, ['/public/a.jpg', '/public/b.jpg']);
  assert.deepEqual(result.photos[0].film, {
    roll: 'classic-chrome',
    strength: 0.7,
    sourceLook: {maker: 'fujifilm', label: '经典铬', roll: 'classic-chrome'},
    date: '2026-10-02',
    seed: filmSeedFor('a.jpg'),
  });
  assert.deepEqual(result.photos[1].film, {roll: 'velvia', strength: 0.4, sourceLook: null, date: '2026-10-02', seed: filmSeedFor('b.jpg')});
  assert.deepEqual(result.photos[2].film, result.photos[0].film);
  assert.equal('film' in result.photos[3], false);
  assert.equal('film' in result.photos[4], false);
});

test('command-line film flags replace the whole-roll default but keep photo overrides', async () => {
  const readFilm = () => ({version: 1, roll: 'classic-chrome', strength: 0.7, photos: {'b.jpg': {roll: 'velvia', strength: 0.4}}});
  const swapped = await applyRenderVariants(timeline(), {film: 'acros', filmStrength: 0.3}, {
    resolvePhotoPath: (src) => src,
    readFilm,
    extractFilmSource: filmSource,
  });
  assert.equal(swapped.photos[0].film.roll, 'acros');
  assert.equal(swapped.photos[0].film.strength, 0.3);
  assert.equal(swapped.photos[1].film.roll, 'velvia');
  const none = await applyRenderVariants(timeline(), {film: null}, {resolvePhotoPath: (src) => src, readFilm, extractFilmSource: filmSource});
  assert.equal('film' in none.photos[0], false);
  assert.equal(none.photos[1].film.roll, 'velvia');
});

test('render reads film.json from the project folder and keys photos by their project path', async () => {
  const folder = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kiseki-render-film-')));
  try {
    writeFilmSettings(filmSettingsPathFor(folder), {roll: null, strength: 1, photos: {'day1/a.jpg': {roll: 'eterna', strength: 0.5}}});
    const tl = {...timeline(), photos: [{src: 'day1/a.jpg', start: 0}, {src: 'b.jpg', start: 1}]};
    const result = await applyRenderVariants(tl, {}, {
      resolvePhotoPath: (src) => path.join(folder, src),
      publicDir: folder,
      extractFilmSource: async () => ({sourceLook: null, date: null}),
    });
    assert.deepEqual(result.photos[0].film, {roll: 'eterna', strength: 0.5, sourceLook: null, date: null, seed: filmSeedFor('day1/a.jpg')});
    assert.equal('film' in result.photos[1], false);
  } finally {
    fs.rmSync(folder, {recursive: true, force: true});
  }
});

test('the internal render entry reads forwarded film flags', () => {
  const flags = (values) => readFilmFlags((flag) => values[flag]);
  assert.deepEqual(flags({}), {});
  assert.deepEqual(flags({'--film': 'none'}), {film: null});
  assert.deepEqual(flags({'--film': 'velvia', '--film-strength': '0.25'}), {film: 'velvia', filmStrength: 0.25});
  assert.throws(() => flags({'--film': 'kodachrome'}), /未知胶卷/);
  assert.throws(() => flags({'--film-strength': '2'}), /0–1/);
  assert.throws(() => flags({'--film-strength': 'x'}), /0–1/);
});
