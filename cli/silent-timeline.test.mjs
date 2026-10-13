import assert from 'node:assert/strict';
import test from 'node:test';

import {buildSilentTimeline} from './silent-timeline.mjs';
import {validateTimeline} from './timeline-validator.mjs';

const config = {
  transition: 'album',
  album_fade: 0.4,
  crossfade: 0.6,
  width: 1920,
  height: 1080,
  fps: 60,
  background: '#FFFFFF',
  photo_scale: 0.8,
};

test('a silent timeline spaces photos evenly and keeps audio empty', () => {
  const timeline = buildSilentTimeline({photos: ['a.jpg', 'b.jpg'], config});
  validateTimeline(timeline);
  assert.equal(timeline.meta.audio, '');
  assert.equal(timeline.meta.duration, 8);
  assert.equal(timeline.meta.branding.intro, false);
  assert.deepEqual(timeline.subtitles, []);
  assert.equal(timeline.photos[0].transition.type, 'none');
  assert.equal(timeline.photos[1].transition.type, 'album');
  assert.equal(timeline.photos[1].start, 4);
  assert.equal(timeline.photos[1].end, 8);
});

test('a silent timeline copies explicit branding and leaves the intro off otherwise', () => {
  assert.deepEqual(buildSilentTimeline({photos: ['a.jpg'], config}).meta.branding, {intro: false});
  const custom = buildSilentTimeline({
    photos: ['a.jpg'],
    config: {...config, outro_text: '', signature: 'mark.svg', intro: true},
    explicitKeys: new Set(['outro_text', 'signature', 'intro']),
  });
  assert.deepEqual(custom.meta.branding, {outro_text: '', signature: 'mark.svg', intro: true});
});

test('a silent timeline follows the configured cut or crossfade', () => {
  const cut = buildSilentTimeline({photos: ['a.jpg', 'b.jpg'], config: {...config, transition: 'cut'}});
  const fade = buildSilentTimeline({photos: ['a.jpg', 'b.jpg'], config: {...config, transition: 'crossfade', crossfade: 0.6}});
  assert.deepEqual(cut.photos[1].transition, {type: 'cut', duration: 0});
  assert.deepEqual(fade.photos[1].transition, {type: 'crossfade', duration: 0.6});
});

test('a silent timeline keeps every photo and inserts a readable card at every date change', () => {
  const timeline = buildSilentTimeline({
    photos: ['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg'],
    config: {...config, chapters: true},
    shotTimes: ['20260521080000000', '20260522090000000', '20260522100000000', '20260523090000000'],
  });
  validateTimeline(timeline);
  assert.deepEqual(timeline.meta.chapters, {enabled: true, day_count: 3, card_count: 2});
  assert.equal(timeline.meta.duration, 16);
  assert.deepEqual(timeline.photos.map(({kind}) => kind), ['photo', 'chapter', 'photo', 'photo', 'chapter', 'photo']);
  assert.deepEqual(timeline.photos.filter(({kind}) => kind === 'chapter').map(({text, start, end}) => ({text, start, end})), [
    {text: '5月22日 · 第2天 ♪', start: 3.5, end: 4.5},
    {text: '5月23日 · 第3天 ✦', start: 11.5, end: 12.5},
  ]);
  assert.deepEqual(timeline.photos.filter(({kind}) => kind === 'photo').map(({src}) => src), ['./a.jpg', './b.jpg', './c.jpg', './d.jpg']);
  for (let index = 1; index < timeline.photos.length; index += 1) {
    assert.equal(timeline.photos[index - 1].end, timeline.photos[index].start);
  }
  assert.deepEqual(timeline.photos[2].transition, {type: 'none', duration: 0});
});

test('missing or invalid shot dates disable all silent chapters without changing photo timing', () => {
  for (const shotTimes of [
    ['20260521080000000', null],
    ['20260521080000000', '20260230090000000'],
    ['20260521080000000'],
  ]) {
    const timeline = buildSilentTimeline({photos: ['a.jpg', 'b.jpg'], config: {...config, chapters: true}, shotTimes});
    validateTimeline(timeline);
    assert.deepEqual(timeline.meta.chapters, {enabled: false, day_count: 0, card_count: 0});
    assert.deepEqual(timeline.photos.map(({start, end}) => [start, end]), [[0, 4], [4, 8]]);
  }
});

test('a single dated day and disabled chapters keep the original silent layout', () => {
  const shotTimes = ['20260521080000000', '20260521090000000'];
  const singleDay = buildSilentTimeline({photos: ['a.jpg', 'b.jpg'], config: {...config, chapters: true}, shotTimes});
  const disabled = buildSilentTimeline({photos: ['a.jpg', 'b.jpg'], config: {...config, chapters: false}, shotTimes});
  assert.deepEqual(singleDay.meta.chapters, {enabled: false, day_count: 1, card_count: 0});
  assert.deepEqual(disabled.meta.chapters, {enabled: false, day_count: 0, card_count: 0});
  assert.deepEqual(singleDay.photos, disabled.photos);
});

test('consecutive daily changes retain a positive duration for each photo', () => {
  const timeline = buildSilentTimeline({
    photos: ['a.jpg', 'b.jpg', 'c.jpg'],
    config: {...config, chapters: true},
    shotTimes: ['20260521080000000', '20260522080000000', '20260523080000000'],
  });
  validateTimeline(timeline);
  assert.deepEqual(timeline.meta.chapters, {enabled: true, day_count: 3, card_count: 2});
  assert.deepEqual(timeline.photos.filter(({kind}) => kind === 'photo').map(({start, end}) => end - start), [3.5, 3, 3.5]);
  for (let index = 1; index < timeline.photos.length; index += 1) {
    assert.equal(timeline.photos[index - 1].end, timeline.photos[index].start);
  }
});

test('complete EXIF shooting times determine silent photo and chapter order', () => {
  const photos = ['a-late.jpg', 'b-early.jpg', 'd-tie.jpg', 'c-tie.jpg'];
  const shotTimes = ['20260523080000000', '20260521090000000', '20260522080000000', '20260522080000000'];
  const timeline = buildSilentTimeline({photos, config: {...config, chapters: true}, shotTimes});
  validateTimeline(timeline);
  assert.deepEqual(timeline.photos.filter(({kind}) => kind === 'photo').map(({src}) => src), [
    './b-early.jpg', './c-tie.jpg', './d-tie.jpg', './a-late.jpg',
  ]);
  assert.deepEqual(timeline.photos.filter(({kind}) => kind === 'chapter').map(({text}) => text), [
    '5月22日 · 第2天 ♪', '5月23日 · 第3天 ✦',
  ]);
  const incomplete = buildSilentTimeline({photos, config: {...config, chapters: true}, shotTimes: [null, ...shotTimes.slice(1)]});
  const disabled = buildSilentTimeline({photos, config: {...config, chapters: false}, shotTimes});
  for (const result of [incomplete, disabled]) {
    assert.deepEqual(result.photos.map(({src}) => src), photos.map((name) => `./${name}`));
  }
});
