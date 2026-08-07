import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {applyRenderVariants, detectParallelism, formatRenderDiagnostics, resolveRenderSettings} from './render.mjs';

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

test('sign sets meta.sign to true', async () => {
  const result = await applyRenderVariants(timeline(), {sign: true}, {resolvePhotoPath: (src) => src});
  assert.equal(result.meta.sign, true);
});

test('filterConfig writes per-photo clip.filter, and a --filter flag overrides every clip', async () => {
  const filterConfig = {
    filter: 'mono',
    intensity: 0.5,
    perPhoto: {'b.jpg': {filter: 'riso', intensity: 0.9}},
  };
  const withConfig = await applyRenderVariants(timeline(), {}, {resolvePhotoPath: (src) => src, filterConfig});
  assert.deepEqual(withConfig.photos[0].filter, {id: 'mono', intensity: 0.5});
  assert.deepEqual(withConfig.photos[1].filter, {id: 'riso', intensity: 0.9});
  assert.deepEqual(withConfig.photos[2].filter, {id: 'mono', intensity: 0.5});

  const withCliOverride = await applyRenderVariants(
    timeline(),
    {filter: {id: 'warm'}},
    {resolvePhotoPath: (src) => src, filterConfig},
  );
  assert.deepEqual(withCliOverride.photos[0].filter, {id: 'warm'});
  assert.deepEqual(withCliOverride.photos[1].filter, {id: 'warm'});
});

test('without filterConfig, clip.filter is left untouched', async () => {
  const result = await applyRenderVariants(timeline(), {}, {resolvePhotoPath: (src) => src});
  assert.equal(result.photos[0].filter, undefined);
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

test('Diary clears a photo fade-out before a chapter and layers chapters over subtitles', () => {
  const diary = fs.readFileSync(new URL('../renderer/src/Diary.tsx', import.meta.url), 'utf8');
  assert.match(diary, /const visualClips = photos\.filter\(\(clip\) => isPhotoClip\(clip\) \|\| isChapterClip\(clip\)\);/);
  assert.match(diary, /const isPhotoClip = \(clip: VisualClip \| undefined\)/);
  assert.match(diary, /const dOut = isPhotoClip\(nextClip\) \? getFadeDuration\(template\.transition \?\? nextClip\.transition\) : 0;/);
  assert.match(diary, /typeof clip\.src === 'string'/);
  assert.ok(diary.indexOf('<Subtitle') < diary.indexOf('<ChapterCard'));
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
    assert.throws(() => resolveRenderSettings({envConcurrency: value}), /TSUZURI_CONCURRENCY/);
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
