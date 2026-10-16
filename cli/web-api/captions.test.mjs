import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {CACHE_VERSION, loadCaptionCache, readCaptionCacheState} from '../ai/photo-caption-cache.mjs';
import {CAPTION_MODEL, PROMPT_VERSION, promptHash} from '../ai/photo-caption-prompt.mjs';
import {PREVIEW_WIDTH, readSourceStat, sourceIdentityRecord} from '../image-identity.mjs';
import {createTaskLeaseManager} from '../task-lease.mjs';
import {CaptionRequestError, clearPhotoCaptions, generatePhotoCaption, savePhotoCaption} from './captions.mjs';

const fixture = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kiseki-captions-api-')));
const stubLeaseManager = () => ({acquire: () => ({}), release: () => true});
const successfulPrepare = async ({sources}) => ({results: new Map([[sources[0].key, {text: '风从照片外面进来'}]])});
const deps = () => ({
  isJobRunning: () => false,
  leaseManager: stubLeaseManager(),
  getApiKey: () => 'test-key',
  prepare: successfulPrepare,
});

test('saving a caption keeps the wording and marks it as edited', async () => {
  const dir = fixture();
  try {
    const photo = path.join(dir, 'photo.jpg');
    fs.writeFileSync(photo, 'image');
    const identity = sourceIdentityRecord('photo.jpg', readSourceStat(photo), PREVIEW_WIDTH);
    fs.mkdirSync(path.join(dir, 'output', 'metadata'), {recursive: true});
    fs.writeFileSync(path.join(dir, 'output', 'metadata', 'ai-captions.json'), JSON.stringify({
      version: CACHE_VERSION,
      model: CAPTION_MODEL,
      prompt_hash: promptHash,
      prompt_version: PROMPT_VERSION,
      revision: 1,
      items: {
        'photo.jpg': {text: '伞忘在门口了', hint: '伞', source_identity: identity, preview_sha256: 'a'.repeat(64)},
      },
    }));
    const result = await savePhotoCaption({
      folder: dir,
      assetId: 'photo:photo.jpg',
      text: '比昨天还轻',
      isJobRunning: () => false,
      leaseManager: stubLeaseManager(),
    });
    assert.deepEqual(result, {caption: '比昨天还轻', captionEdited: true, captionHint: '伞'});
    assert.equal(loadCaptionCache(path.join(dir, 'output', 'metadata', 'ai-captions.json')).items['photo.jpg'].edited, true);
    await assert.rejects(
      () => savePhotoCaption({
        folder: dir,
        assetId: 'photo:photo.jpg',
        text: '字'.repeat(31),
        isJobRunning: () => false,
        leaseManager: stubLeaseManager(),
      }),
      (error) => error instanceof CaptionRequestError && error.status === 400 && error.message === '最多 30 个字',
    );
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
  }
});

test('clearing captions removes edited entries but preserves photos and finished videos', async () => {
  const dir = fixture();
  try {
    const photo = path.join(dir, 'photo.jpg');
    const video = path.join(dir, 'output', 'finished.mp4');
    const cachePath = path.join(dir, 'output', 'metadata', 'ai-captions.json');
    fs.writeFileSync(photo, 'image');
    fs.mkdirSync(path.dirname(cachePath), {recursive: true});
    fs.writeFileSync(video, 'finished');
    fs.writeFileSync(cachePath, JSON.stringify({
      version: CACHE_VERSION,
      model: CAPTION_MODEL,
      prompt_hash: promptHash,
      prompt_version: PROMPT_VERSION,
      revision: 1,
      items: {'photo.jpg': {text: '手动改过', edited: true}},
    }));
    const expectedFingerprint = readCaptionCacheState(cachePath).fingerprint;
    const result = await clearPhotoCaptions({folder: dir, expectedRevision: 1, expectedFingerprint, isJobRunning: () => false, leaseManager: stubLeaseManager()});
    assert.deepEqual(result, {cleared: 1});
    assert.deepEqual(loadCaptionCache(cachePath).items, {});
    assert.equal(fs.readFileSync(photo, 'utf8'), 'image');
    assert.equal(fs.readFileSync(video, 'utf8'), 'finished');
    await assert.rejects(
      () => clearPhotoCaptions({folder: dir, expectedRevision: 1, expectedFingerprint, isJobRunning: () => false, leaseManager: stubLeaseManager()}),
      (error) => error instanceof CaptionRequestError && error.status === 409,
    );
    await assert.rejects(
      () => clearPhotoCaptions({folder: dir, expectedRevision: 2, expectedFingerprint, isJobRunning: () => true, leaseManager: stubLeaseManager()}),
      (error) => error instanceof CaptionRequestError && error.status === 409,
    );
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
  }
});

test('clear replaces an incompatible cache only when its fingerprint still matches', async () => {
  const dir = fixture();
  try {
    const cachePath = path.join(dir, 'output', 'metadata', 'ai-captions.json');
    fs.mkdirSync(path.dirname(cachePath), {recursive: true});
    fs.writeFileSync(cachePath, JSON.stringify({version: 0, items: {'old.jpg': {text: '旧旁白'}}}));
    const first = readCaptionCacheState(cachePath);
    assert.equal(first.invalid, true);
    assert.equal(first.itemCount, 1);
    fs.writeFileSync(cachePath, JSON.stringify({version: 0, items: {'new.jpg': {text: '更新'}}}));
    await assert.rejects(
      () => clearPhotoCaptions({folder: dir, expectedRevision: 0, expectedFingerprint: first.fingerprint, leaseManager: stubLeaseManager()}),
      (error) => error instanceof CaptionRequestError && error.status === 409,
    );
    const current = readCaptionCacheState(cachePath);
    assert.deepEqual(await clearPhotoCaptions({folder: dir, expectedRevision: 0, expectedFingerprint: current.fingerprint, leaseManager: stubLeaseManager()}), {cleared: 1});
    assert.deepEqual(loadCaptionCache(cachePath).items, {});
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
  }
});

test('single caption generation rejects non-photo assets and missing files', async () => {
  const dir = fixture();
  try {
    fs.writeFileSync(path.join(dir, 'song.mp3'), '');
    await assert.rejects(
      () => generatePhotoCaption({folder: dir, assetId: 'audio:song.mp3', isJobRunning: () => false}),
      (error) => error instanceof CaptionRequestError && error.status === 400,
    );
    await assert.rejects(
      () => generatePhotoCaption({folder: dir, assetId: 'photo:missing.jpg', isJobRunning: () => false}),
      (error) => error instanceof CaptionRequestError && error.status === 404,
    );
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
  }
});

test('single caption generation succeeds while holding the project lease', async () => {
  const dir = fixture();
  try {
    fs.writeFileSync(path.join(dir, 'photo.jpg'), 'image');
    let held = false;
    const leaseManager = {
      acquire: () => { held = true; return {}; },
      release: () => { held = false; return true; },
    };
    const result = await generatePhotoCaption({
      folder: dir,
      assetId: 'photo:photo.jpg',
      hint: '  黄昏   海边 ',
      ...deps(),
      leaseManager,
      prepare: async (options) => {
        assert.equal(held, true);
        assert.equal(options.hint, '黄昏 海边');
        return successfulPrepare(options);
      },
    });
    assert.deepEqual(result, {caption: '风从照片外面进来', captionHint: '黄昏 海边'});
    assert.equal(held, false);
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});

test('rejects a file folder and symlinked caption inputs or cache parents', async () => {
  const dir = fixture();
  const outside = fixture();
  try {
    const file = path.join(dir, 'not-a-folder');
    fs.writeFileSync(file, 'x');
    await assert.rejects(
      () => generatePhotoCaption({folder: file, assetId: 'photo:a.jpg', ...deps()}),
      (error) => error instanceof CaptionRequestError && error.status === 400,
    );

    fs.writeFileSync(path.join(outside, 'outside.jpg'), 'image');
    fs.symlinkSync(path.join(outside, 'outside.jpg'), path.join(dir, 'linked.jpg'));
    await assert.rejects(
      () => generatePhotoCaption({folder: dir, assetId: 'photo:linked.jpg', ...deps()}),
      (error) => error instanceof CaptionRequestError && error.status === 409,
    );

    fs.rmSync(path.join(dir, 'linked.jpg'));
    fs.writeFileSync(path.join(dir, 'photo.jpg'), 'image');
    fs.mkdirSync(path.join(outside, 'metadata'));
    fs.symlinkSync(outside, path.join(dir, 'output'));
    await assert.rejects(
      () => generatePhotoCaption({folder: dir, assetId: 'photo:photo.jpg', ...deps()}),
      (error) => error instanceof CaptionRequestError && error.status === 409,
    );
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
    fs.rmSync(outside, {recursive: true, force: true});
  }
});

test('concurrent caption generation reports the durable project lease as busy', async () => {
  const dir = fixture();
  const registryRoot = fixture();
  try {
    fs.writeFileSync(path.join(dir, 'photo.jpg'), 'image');
    const leaseManager = createTaskLeaseManager({registryRoot});
    let unblock;
    const waiting = new Promise((resolve) => { unblock = resolve; });
    let started;
    const entered = new Promise((resolve) => { started = resolve; });
    const first = generatePhotoCaption({
      folder: dir,
      assetId: 'photo:photo.jpg',
      ...deps(),
      leaseManager,
      prepare: async (options) => { started(); await waiting; return successfulPrepare(options); },
    });
    await entered;
    await assert.rejects(
      () => generatePhotoCaption({folder: dir, assetId: 'photo:photo.jpg', ...deps(), leaseManager}),
      (error) => error instanceof CaptionRequestError && error.status === 409,
    );
    unblock();
    await first;
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
    fs.rmSync(registryRoot, {recursive: true, force: true});
  }
});

test('rejects a source changed during caption generation', async () => {
  const dir = fixture();
  try {
    const photo = path.join(dir, 'photo.jpg');
    fs.writeFileSync(photo, 'image');
    await assert.rejects(
      () => generatePhotoCaption({
        folder: dir,
        assetId: 'photo:photo.jpg',
        ...deps(),
        prepare: async (options) => {
          fs.appendFileSync(photo, '-changed');
          return successfulPrepare(options);
        },
      }),
      (error) => error instanceof CaptionRequestError && error.status === 409,
    );
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});

test('forwards abort signal to caption preparation and maps cancellation', async () => {
  const dir = fixture();
  try {
    fs.writeFileSync(path.join(dir, 'photo.jpg'), 'image');
    const controller = new AbortController();
    const pending = generatePhotoCaption({
      folder: dir,
      assetId: 'photo:photo.jpg',
      ...deps(),
      signal: controller.signal,
      prepare: ({signal}) => new Promise((resolve, reject) => {
        assert.equal(signal, controller.signal);
        signal.addEventListener('abort', () => reject(Object.assign(new Error('cancelled'), {code: 'cancelled'})), {once: true});
      }),
    });
    controller.abort();
    await assert.rejects(pending, (error) => error instanceof CaptionRequestError && error.status === 499);
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});
