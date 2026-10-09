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
