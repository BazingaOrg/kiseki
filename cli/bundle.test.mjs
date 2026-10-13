import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {createRuntimeLayout} from './runtime-layout.mjs';
import {bundleRenderer} from './bundle.mjs';

const makeRuntime = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kiseki-bundle-'));
  return createRuntimeLayout({
    sourceRoot: root,
    cacheRoot: path.join(root, 'cache'),
    rendererRoot: path.join(root, 'renderer'),
  });
};

const stubBundle = (observe) => async (args) => {
  observe?.(args);
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'remotion-webpack-bundle-'));
  fs.mkdirSync(path.join(outDir, 'public'));
  fs.writeFileSync(path.join(outDir, 'index.html'), '<html></html>');
  args.onDirectoryCreated?.(outDir);
  return outDir;
};

test('a bundle uses a temporary output and removes it on cleanup', async () => {
  const runtime = makeRuntime();
  let argumentsSeen;
  const bundled = await bundleRenderer('/album', {
    runtime,
    bundle: stubBundle((args) => { argumentsSeen = args; }),
  });
  assert.equal(argumentsSeen.publicDir, '/album');
  assert.equal(argumentsSeen.symlinkPublicDir, true);
  assert.equal(argumentsSeen.enableCaching, false);
  assert.equal(argumentsSeen.outDir, undefined);
  assert.ok(fs.existsSync(path.join(bundled.bundleDir, 'index.html')));
  bundled.cleanup();
  assert.equal(fs.existsSync(bundled.bundleDir), false);
});

test('concurrent bundles keep their materials isolated through cleanup', async () => {
  const runtime = makeRuntime();
  const [first, second] = await Promise.all([
    bundleRenderer('/first/album', {runtime, bundle: stubBundle()}),
    bundleRenderer('/second/album', {runtime, bundle: stubBundle()}),
  ]);
  assert.notEqual(first.bundleDir, second.bundleDir);
  fs.writeFileSync(path.join(second.bundleDir, 'public', 'photo.jpg'), 'second');
  first.cleanup();
  assert.equal(fs.existsSync(first.bundleDir), false);
  assert.equal(fs.readFileSync(path.join(second.bundleDir, 'public', 'photo.jpg'), 'utf8'), 'second');
  second.cleanup();
  assert.equal(fs.existsSync(second.bundleDir), false);
});

test('a failed bundle removes its own output directory', async () => {
  const runtime = makeRuntime();
  let directory;
  await assert.rejects(bundleRenderer('/album', {
    runtime,
    bundle: async (args) => {
      directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kiseki-failed-bundle-'));
      args.onDirectoryCreated(directory);
      throw new Error('bundle failed');
    },
  }), /bundle failed/);
  assert.equal(fs.existsSync(directory), false);
});
