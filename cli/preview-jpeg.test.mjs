import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import test from 'node:test';

import {envWithoutSecrets} from './ai/caption-runtime.mjs';
import {encodeJpegStrict} from './preview-jpeg.mjs';

test('envWithoutSecrets drops DEEPSEEK_API_KEY', () => {
  const filtered = envWithoutSecrets({DEEPSEEK_API_KEY: 'secret', PATH: '/bin', OTHER: '1'});
  assert.equal(filtered.DEEPSEEK_API_KEY, undefined);
  assert.equal(filtered.PATH, '/bin');
  assert.equal(filtered.OTHER, '1');
});

test('ffmpeg spawn inherits an env without DEEPSEEK_API_KEY', async () => {
  const previous = process.env.DEEPSEEK_API_KEY;
  process.env.DEEPSEEK_API_KEY = 'secret-from-parent';
  try {
    let spawnEnv = null;
    const child = new EventEmitter();
    child.pid = 4242;
    const pending = encodeJpegStrict('/src.jpg', '/dst.jpg', 640, {
      spawn: (_cmd, _args, options) => {
        spawnEnv = options.env;
        return child;
      },
      timeoutMs: 5_000,
      lifecycle: {
        identity: () => ({pid: 4242, start: 't'}),
        snapshot: () => ({known: true, descendants: []}),
        freeze: () => ({confirmed: true, descendants: [], frozen: []}),
        signalGroup: () => true,
        signalTree: () => true,
        absent: () => true,
        resume: () => {},
      },
    });
    assert.ok(spawnEnv);
    assert.equal(spawnEnv.DEEPSEEK_API_KEY, undefined);
    setImmediate(() => child.emit('close', 1));
    assert.equal(await pending, false);
  } finally {
    if (previous === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = previous;
  }
});
