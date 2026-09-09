import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {CaptionHttpError} from './deepseek-vision-client.mjs';
import {assertUnchangedSources, preparePhotoCaptions} from './photo-caption-service.mjs';
import {validateCaption} from './photo-caption-prompt.mjs';

const fixture = () => fs.mkdtempSync(path.join(os.tmpdir(), 'kiseki-caption-service-'));

const writePhoto = (dir, name, contents = 'photo') => {
  const absPath = path.join(dir, name);
  fs.writeFileSync(absPath, contents);
  return absPath;
};

const jpegPreview = {
  buffer: Buffer.from('jpeg'),
  sha256: 'b'.repeat(64),
  width: 640,
  height: 480,
};

test('warm cache hits skip generate and materialize', async () => {
  const dir = fixture();
  try {
    const photo = writePhoto(dir, '001.jpg');
    let generates = 0;
    let materializes = 0;
    const first = await preparePhotoCaptions({
      projectRoot: dir,
      sources: [photo],
      apiKey: 'k',
      generateCaption: async () => {
        generates += 1;
        return {validation: validateCaption('坐得端正，也不耽误心里走神'), usage: {input_tokens: 1, output_tokens: 1}};
      },
      materialize: async () => {
        materializes += 1;
        return jpegPreview;
      },
    });
    assert.equal(first.generated, 1);
    const second = await preparePhotoCaptions({
      projectRoot: dir,
      sources: [photo],
      apiKey: 'k',
      generateCaption: async () => { generates += 1; throw new Error('network'); },
      materialize: async () => { materializes += 1; throw new Error('encode'); },
    });
    assert.equal(second.reused, 1);
    assert.equal(second.generated, 0);
    assert.equal(generates, 1);
    assert.equal(materializes, 1);
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
  }
});

test('401 aborts the rest of the batch', async () => {
  const dir = fixture();
  try {
    const photos = [writePhoto(dir, 'a.jpg'), writePhoto(dir, 'b.jpg'), writePhoto(dir, 'c.jpg')];
    let calls = 0;
    await assert.rejects(
      () => preparePhotoCaptions({
        projectRoot: dir,
        sources: photos,
        apiKey: 'k',
        generateCaption: async ({signal}) => {
          calls += 1;
          if (calls === 1) throw new CaptionHttpError('auth', 401, false, true);
          await new Promise((resolve, reject) => {
            signal.addEventListener('abort', () => reject(new CaptionHttpError('cancelled', 0, false, false)), {once: true});
          });
        },
        materialize: async () => jpegPreview,
      }),
      (error) => error.batchFatal === true,
    );
    assert.ok(calls >= 1);
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
  }
});

test('source identity change after encode fails the task and keeps other cache items', async () => {
  const dir = fixture();
  try {
    const keep = writePhoto(dir, 'keep.jpg', 'keep');
    await preparePhotoCaptions({
      projectRoot: dir,
      sources: [keep],
      apiKey: 'k',
      generateCaption: async () => ({validation: validateCaption('看似平淡但有余味的一句'), usage: {input_tokens: 1, output_tokens: 1}}),
      materialize: async () => jpegPreview,
    });
    const changing = writePhoto(dir, 'change.jpg', 'one');
    await assert.rejects(
      () => preparePhotoCaptions({
        projectRoot: dir,
        sources: [changing],
        apiKey: 'k',
        generateCaption: async () => ({validation: validateCaption('另一句旁白也要合规啊'), usage: {input_tokens: 1, output_tokens: 1}}),
        materialize: async () => {
          fs.writeFileSync(changing, 'two-bytes-changed');
          return jpegPreview;
        },
      }),
      /照片已变化/,
    );
    const cache = JSON.parse(fs.readFileSync(path.join(dir, 'output', 'metadata', 'ai-captions.json'), 'utf8'));
    assert.ok(cache.items['keep.jpg']);
    assert.equal(cache.items['change.jpg'], undefined);
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
  }
});

test('abort after in-flight work maps to cancelled and drains siblings', async () => {
  const dir = fixture();
  const rejections = [];
  const onUnhandled = (error) => { rejections.push(error); };
  process.on('unhandledRejection', onUnhandled);
  try {
    const photos = [writePhoto(dir, 'a.jpg'), writePhoto(dir, 'b.jpg'), writePhoto(dir, 'c.jpg')];
    const controller = new AbortController();
    let entered = 0;
    await assert.rejects(
      () => preparePhotoCaptions({
        projectRoot: dir,
        sources: photos,
        apiKey: 'k',
        signal: controller.signal,
        generateCaption: async ({signal}) => {
          entered += 1;
          if (entered === 1) controller.abort();
          await new Promise((_, reject) => {
            const fail = () => reject(Object.assign(new Error('aborted'), {code: 'cancelled', name: 'AbortError'}));
            if (signal.aborted) {
              fail();
              return;
            }
            signal.addEventListener('abort', fail, {once: true});
          });
        },
        materialize: async () => jpegPreview,
      }),
      (error) => error.code === 'cancelled',
    );
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(rejections.length, 0);
  } finally {
    process.off('unhandledRejection', onUnhandled);
    fs.rmSync(dir, {recursive: true, force: true});
  }
});

test('assertUnchangedSources fails when the file identity no longer matches the cache', async () => {
  const dir = fixture();
  try {
    const photo = writePhoto(dir, '001.jpg', 'one');
    const prepared = await preparePhotoCaptions({
      projectRoot: dir,
      sources: [photo],
      apiKey: 'k',
      generateCaption: async () => ({validation: validateCaption('看似平淡但有余味的一句'), usage: {input_tokens: 1, output_tokens: 1}}),
      materialize: async () => jpegPreview,
    });
    assertUnchangedSources(dir, [{absPath: photo, key: '001.jpg'}], prepared.cache);
    fs.writeFileSync(photo, 'changed-bytes');
    assert.throws(
      () => assertUnchangedSources(dir, [{absPath: photo, key: '001.jpg'}], prepared.cache),
      /照片已变化/,
    );
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
  }
});

test('ffmpeg failure does not call the network', async () => {
  const dir = fixture();
  try {
    const photo = writePhoto(dir, '001.jpg');
    let generates = 0;
    await assert.rejects(
      () => preparePhotoCaptions({
        projectRoot: dir,
        sources: [photo],
        apiKey: 'k',
        generateCaption: async () => { generates += 1; throw new Error('should-not-run'); },
        materialize: async () => { throw new Error('preview-encode-failed'); },
      }),
      /preview-encode-failed/,
    );
    assert.equal(generates, 0);
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
  }
});
