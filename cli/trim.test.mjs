import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {maybePersistTrimChoice} from './trim.mjs';

const makeFolder = () => fs.mkdtempSync(path.join(os.tmpdir(), 'kiseki-trim-'));
const timeline = {
  meta: {trim: {mode: 'auto', applied: true, full_duration: 60, trimmed_duration: 24}},
  photos: [{src: 'a.jpg'}, {src: 'b.jpg'}, {src: 'c.jpg'}],
};

test('trim prompt counts only legacy and explicit real photos', async () => {
  const folder = makeFolder();
  let question = '';
  try {
    await maybePersistTrimChoice({
      folder,
      timeline: {...timeline, photos: [
        {src: 'legacy.jpg'}, {kind: 'photo', src: 'photo.jpg'},
        {kind: 'chapter', text: '第2天', start: 1, end: 3, src: 'chapter.jpg'},
        {kind: 'future', src: 'future.jpg'}, {kind: 'photo'},
      ]},
      interactive: true,
      promptRunner: async (run) => run({pick: async (text) => { question = text; return {index: 0}; }}),
    });
    assert.match(question, /平均每张 12\.0 秒/);
  } finally {
    fs.rmSync(folder, {recursive: true, force: true});
  }
});

test('interactive first auto trim persists the accepted default', async () => {
  const folder = makeFolder();
  let question = '';
  try {
    const result = await maybePersistTrimChoice({
      folder,
      timeline,
      interactive: true,
      promptRunner: async (run) => run({
        pick: async (text) => {
          question = text;
          return {index: 0, item: '接受裁剪'};
        },
      }),
    });
    assert.equal(result, 'auto');
    assert.match(question, /24\.0 秒重拍处截断.*平均每张 8\.0 秒/);
    assert.deepEqual(
      JSON.parse(fs.readFileSync(path.join(folder, 'output', 'metadata', 'preferences.json'), 'utf8')),
      {version: 1, trim: 'auto'},
    );
    assert.equal(fs.existsSync(path.join(folder, 'kiseki.toml')), false);
  } finally {
    fs.rmSync(folder, {recursive: true, force: true});
  }
});

test('interactive choice can persist full-song playback', async () => {
  const folder = makeFolder();
  try {
    const result = await maybePersistTrimChoice({
      folder,
      timeline,
      interactive: true,
      promptRunner: async (run) => run({pick: async () => ({index: 1, item: '播完整首歌'})}),
    });
    assert.equal(result, 'full');
    assert.deepEqual(
      JSON.parse(fs.readFileSync(path.join(folder, 'output', 'metadata', 'preferences.json'), 'utf8')),
      {version: 1, trim: 'full'},
    );
  } finally {
    fs.rmSync(folder, {recursive: true, force: true});
  }
});

test('non-interactive, explicit config, override, and unapplied trim do not prompt', async () => {
  for (const scenario of [
    {interactive: false},
    {interactive: true, planOutcome: 'preserved_manual_edit'},
    {interactive: true, trimOverride: 'full'},
    {interactive: true, timeline: {...timeline, meta: {trim: {...timeline.meta.trim, applied: false}}}},
  ]) {
    const folder = makeFolder();
    let prompted = false;
    try {
      const result = await maybePersistTrimChoice({
        folder,
        timeline: scenario.timeline ?? timeline,
        interactive: scenario.interactive,
        planOutcome: scenario.planOutcome ?? 'generated',
        trimOverride: scenario.trimOverride ?? null,
        promptRunner: async () => {
          prompted = true;
        },
      });
      assert.equal(result, null);
      assert.equal(prompted, false);
    } finally {
      fs.rmSync(folder, {recursive: true, force: true});
    }
  }

  const folder = makeFolder();
  fs.mkdirSync(path.join(folder, 'output', 'metadata'), {recursive: true});
  fs.writeFileSync(path.join(folder, 'output', 'metadata', 'preferences.json'), JSON.stringify({version: 1, trim: 'auto'}));
  try {
    let prompted = false;
    const result = await maybePersistTrimChoice({
      folder,
      timeline,
      interactive: true,
      promptRunner: async () => {
        prompted = true;
      },
    });
    assert.equal(result, null);
    assert.equal(prompted, false);
  } finally {
    fs.rmSync(folder, {recursive: true, force: true});
  }
});

test('invalid preferences do not suppress the first auto-trim question', async () => {
  const folder = makeFolder();
  fs.mkdirSync(path.join(folder, 'output', 'metadata'), {recursive: true});
  fs.writeFileSync(path.join(folder, 'output', 'metadata', 'preferences.json'), '{invalid');
  try {
    const result = await maybePersistTrimChoice({
      folder,
      timeline,
      interactive: true,
      promptRunner: async (run) => run({pick: async () => ({index: 0})}),
    });
    assert.equal(result, 'auto');
  } finally {
    fs.rmSync(folder, {recursive: true, force: true});
  }
});
