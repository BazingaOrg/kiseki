import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {createTaskLeaseManager} from '../task-lease.mjs';
import {CaptionRequestError, generatePhotoCaption} from './captions.mjs';

const fixture = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kiseki-captions-api-')));
const stubLeaseManager = () => ({acquire: () => ({}), release: () => true});
const successfulPrepare = async ({sources}) => ({results: new Map([[sources[0].key, {text: '风从照片外面进来'}]])});
const deps = () => ({
  isJobRunning: () => false,
  leaseManager: stubLeaseManager(),
  getApiKey: () => 'test-key',
  prepare: successfulPrepare,
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
