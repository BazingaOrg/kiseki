import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {readTimeline} from './render.mjs';
import {readValidatedTimeline} from './tsuzuri.mjs';
import {TimelineValidationError, validateTimeline} from './timeline-validator.mjs';

const validTimeline = () => JSON.parse(fs.readFileSync(new URL('../examples/fixture/timeline.json', import.meta.url), 'utf8'));

const invalid = (mutate) => {
  const timeline = validTimeline();
  mutate(timeline);
  return timeline;
};

test('accepts the analyzer-compatible fixture without changing it', () => {
  const timeline = validTimeline();
  assert.equal(validateTimeline(timeline), timeline);
  assert.deepEqual(timeline.meta.trim, undefined);
});

test('reports precise paths for root and known clip errors', () => {
  assert.throws(() => validateTimeline(invalid((timeline) => { timeline.meta = null; })), {
    name: 'TimelineValidationError', message: 'timeline $.meta: 必须是对象',
  });
  assert.throws(() => validateTimeline(invalid((timeline) => { delete timeline.photos[1].src; })), /\$\.photos\[1\]\.src/);
  assert.throws(() => validateTimeline(invalid((timeline) => { timeline.photos[2].transition.duration = -1; })), /\$\.photos\[2\]\.transition\.duration/);
  assert.throws(() => validateTimeline(invalid((timeline) => { timeline.photos[0].start = Number.NaN; })), /\$\.photos\[0\]\.start: 必须是有限数字/);
});

test('validates optional renderer fields in their real shapes', () => {
  const timeline = validTimeline();
  timeline.meta.trim = {mode: 'seconds', applied: true, full_duration: 40, trimmed_duration: 30};
  timeline.meta.chapters = {enabled: true, day_count: 2, card_count: 1};
  timeline.meta.branding = {outro_text: '', signature: 'signature.svg', intro: false};
  timeline.meta.filter = null;
  timeline.beats = {bpm: 120, downbeats: [0, 2]};
  timeline.photos[0].motion = {type: 'none', from: 1, to: 1};
  timeline.photos.push({kind: 'chapter', text: '第一天', start: 20, end: 21});
  assert.equal(validateTimeline(timeline), timeline);
  timeline.meta.chapters.card_count = -1;
  assert.throws(() => validateTimeline(timeline), /\$\.meta\.chapters\.card_count/);
});

test('trim duration must not exceed the full duration', () => {
  const timeline = validTimeline();
  timeline.meta.trim = {mode: 'seconds', applied: true, full_duration: 40, trimmed_duration: 30};
  assert.equal(validateTimeline(timeline), timeline);
  timeline.meta.trim.trimmed_duration = 40;
  assert.equal(validateTimeline(timeline), timeline);
  timeline.meta.trim.trimmed_duration = 41;
  assert.throws(() => validateTimeline(timeline), /\$\.meta\.trim\.trimmed_duration/);
});

test('allows legacy kind-less photos and ignores unknown kinds for forward compatibility', () => {
  const timeline = validTimeline();
  delete timeline.photos[0].kind;
  timeline.photos.push({kind: 'future-overlay', unexpected: true});
  assert.equal(validateTimeline(timeline), timeline);
});

test('both CLI timeline readers reject before their downstream render/statistics work', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tsuzuri-invalid-timeline-'));
  const file = path.join(dir, 'timeline.json');
  fs.writeFileSync(file, JSON.stringify(invalid((timeline) => { timeline.subtitles[0].confidence = 'high'; })));
  try {
    for (const read of [readTimeline, readValidatedTimeline]) {
      assert.throws(() => read(file), (error) => error instanceof TimelineValidationError && error.message.includes('$.subtitles[0].confidence'));
    }
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
  }
});

test('entrypoints validate before loading Remotion or reading render statistics', () => {
  const renderSource = fs.readFileSync(new URL('./render.mjs', import.meta.url), 'utf8');
  assert.ok(renderSource.indexOf('const timeline = readTimeline(timelinePath);') < renderSource.indexOf('loadRemotionRenderer()'));
  const cliSource = fs.readFileSync(new URL('./tsuzuri.mjs', import.meta.url), 'utf8');
  assert.ok(cliSource.indexOf('let tl = readValidatedTimeline(timelinePath);') < cliSource.indexOf('const n = tl.photos.filter'));
});
