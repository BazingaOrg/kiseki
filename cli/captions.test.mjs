import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {runCaptions} from './captions.mjs';
import {CACHE_VERSION, loadCaptionCache} from './ai/photo-caption-cache.mjs';
import {CAPTION_MODEL, PROMPT_VERSION, promptHash} from './ai/photo-caption-prompt.mjs';
import {PREVIEW_WIDTH, readSourceStat, sourceIdentityRecord} from './image-identity.mjs';
import {createTaskLeaseManager} from './task-lease.mjs';

test('bulk caption command prepares photos without rendering and keeps the API key out of child environment', async () => {
  const folder = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kiseki-caption-command-')));
  const registryRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kiseki-caption-registry-')));
  const previous = process.env.DEEPSEEK_API_KEY;
  try {
    const first = path.join(folder, 'first.jpg');
    fs.writeFileSync(first, 'image');
    fs.writeFileSync(path.join(folder, 'second.jpg'), 'image');
    const cachePath = path.join(folder, 'output', 'metadata', 'ai-captions.json');
    fs.mkdirSync(path.dirname(cachePath), {recursive: true});
    fs.writeFileSync(cachePath, JSON.stringify({
      version: CACHE_VERSION,
      model: CAPTION_MODEL,
      prompt_hash: promptHash,
      prompt_version: PROMPT_VERSION,
      revision: 1,
      items: {'first.jpg': {text: '手动改过', edited: true, source_identity: sourceIdentityRecord('first.jpg', readSourceStat(first), PREVIEW_WIDTH), preview_sha256: 'a'.repeat(64)}},
    }));
    process.env.DEEPSEEK_API_KEY = 'test-key';
    const result = await runCaptions(folder, {
      leaseManager: createTaskLeaseManager({registryRoot}),
      getApiKey: () => process.env.DEEPSEEK_API_KEY,
      prepare: async ({sources, apiKey, onProgress}) => {
        assert.equal(process.env.DEEPSEEK_API_KEY, undefined);
        assert.equal(apiKey, 'test-key');
        assert.deepEqual(sources.map(({key}) => key), ['second.jpg']);
        onProgress({completed: 1, total: 1, reused: 0, generated: 1});
        return {requiredKeys: ['second.jpg'], reused: 0, generated: 1};
      },
    });
    assert.equal(result, 0);
    assert.equal(process.env.DEEPSEEK_API_KEY, 'test-key');
    assert.equal(loadCaptionCache(cachePath).items['first.jpg'].edited, true);
  } finally {
    if (previous === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = previous;
    fs.rmSync(folder, {recursive: true, force: true});
    fs.rmSync(registryRoot, {recursive: true, force: true});
  }
});

test('complete caption cache needs no API key', async () => {
  const folder = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kiseki-caption-complete-')));
  const registryRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kiseki-caption-registry-')));
  try {
    const photo = path.join(folder, 'only.jpg');
    fs.writeFileSync(photo, 'image');
    const cachePath = path.join(folder, 'output', 'metadata', 'ai-captions.json');
    fs.mkdirSync(path.dirname(cachePath), {recursive: true});
    fs.writeFileSync(cachePath, JSON.stringify({version: CACHE_VERSION, model: CAPTION_MODEL, prompt_hash: promptHash, prompt_version: PROMPT_VERSION, revision: 1, items: {'only.jpg': {text: '保留', source_identity: sourceIdentityRecord('only.jpg', readSourceStat(photo), PREVIEW_WIDTH), preview_sha256: 'a'.repeat(64)}}}));
    const result = await runCaptions(folder, {leaseManager: createTaskLeaseManager({registryRoot}), getApiKey: () => { throw new Error('must not read key'); }, prepare: () => { throw new Error('must not prepare'); }});
    assert.equal(result, 0);
  } finally {
    fs.rmSync(folder, {recursive: true, force: true});
    fs.rmSync(registryRoot, {recursive: true, force: true});
  }
});
