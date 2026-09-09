import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {sourceIdentityRecord} from '../image-identity.mjs';
import {
  cacheHit,
  createSerialWriter,
  isUsableCache,
  loadCaptionCache,
  upsertCaptionItem,
  writeCaptionCache,
} from './photo-caption-cache.mjs';
import {CAPTION_MODEL, promptHash} from './photo-caption-prompt.mjs';

const fixture = () => fs.mkdtempSync(path.join(os.tmpdir(), 'kiseki-caption-cache-'));

const identity = (overrides = {}) => sourceIdentityRecord('photos/001.jpg', {
  dev: 1, ino: 2, size: 123, mtimeNs: 4n, ctimeNs: 5n, ...overrides,
});

const item = (overrides = {}) => ({
  source_identity: identity(),
  preview_sha256: 'a'.repeat(64),
  preview_pixel_width: 640,
  preview_pixel_height: 480,
  text: '坐得端正，也不耽误心里走神',
  usage: {input_tokens: 1, output_tokens: 2},
  ...overrides,
});

test('video and still keys share a cache item', () => {
  const cache = upsertCaptionItem({items: {}}, 'photos/001.jpg', item());
  const hit = cacheHit(cache, 'photos/001.jpg', identity());
  assert.equal(hit.text, '坐得端正，也不耽误心里走神');
});

test('inode or ctime change misses even when size and mtime match', () => {
  const cache = upsertCaptionItem({items: {}}, 'photos/001.jpg', item());
  assert.equal(cacheHit(cache, 'photos/001.jpg', identity({ino: 9})), null);
  assert.equal(cacheHit(cache, 'photos/001.jpg', identity({ctimeNs: 99n})), null);
});

test('prompt or model mismatch is a conservative miss', () => {
  const cache = upsertCaptionItem({items: {}}, 'photos/001.jpg', item());
  assert.equal(isUsableCache({...cache, prompt_hash: 'other'}), false);
  assert.equal(isUsableCache({...cache, model: 'other-model'}), false);
  assert.equal(cacheHit({...cache, prompt_hash: 'other'}, 'photos/001.jpg', identity()), null);
});

test('damaged cache misses instead of reusing old text', () => {
  const dir = fixture();
  const file = path.join(dir, 'ai-captions.json');
  try {
    fs.writeFileSync(file, '{not json');
    const cache = loadCaptionCache(file);
    assert.equal(cache.model, CAPTION_MODEL);
    assert.equal(cache.prompt_hash, promptHash);
    assert.deepEqual(cache.items, {});
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
  }
});

test('serial writer keeps later items when completions finish out of order', async () => {
  const dir = fixture();
  const file = path.join(dir, 'ai-captions.json');
  try {
    const writes = [];
    const writer = createSerialWriter({
      write: (target, cache) => {
        writes.push(Object.keys(cache.items).sort());
        writeCaptionCache(target, cache);
      },
    });
    let cache = {items: {}};
    cache = upsertCaptionItem(cache, 'b.jpg', item({text: '后到', source_identity: identity({ino: 2})}));
    const later = writer.enqueue(file, cache);
    cache = upsertCaptionItem(cache, 'a.jpg', item({text: '先到', source_identity: identity({ino: 1})}));
    const earlier = writer.enqueue(file, cache);
    await Promise.all([later, earlier]);
    await writer.drain();
    const stored = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.deepEqual(Object.keys(stored.items).sort(), ['a.jpg', 'b.jpg']);
    assert.ok(writes.at(-1).includes('a.jpg') && writes.at(-1).includes('b.jpg'));
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
  }
});
