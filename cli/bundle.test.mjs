import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {createRuntimeLayout} from './runtime-layout.mjs';
import {bundleRenderer, remotionBundleCacheDir, resetBundlePublicDir} from './bundle.mjs';

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
  const outDir = args.outDir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'remotion-webpack-bundle-'));
  fs.mkdirSync(outDir, {recursive: true});
  fs.mkdirSync(path.join(outDir, 'public'), {recursive: true});
  fs.writeFileSync(path.join(outDir, 'index.html'), '<html></html>');
  args.onDirectoryCreated?.(outDir);
  return outDir;
};

test('cache dir is stable for one renderer and distinct across renderer roots', () => {
  const runtime = makeRuntime();
  const first = remotionBundleCacheDir(runtime, runtime.rendererRoot);
  const again = remotionBundleCacheDir(runtime, runtime.rendererRoot);
  const other = remotionBundleCacheDir(runtime, path.join(runtime.rendererRoot, 'other'));
  assert.equal(first, again);
  assert.notEqual(first, other);
  assert.equal(path.basename(path.dirname(first)), 'remotion-bundle');
  assert.ok(first.startsWith(runtime.cacheRoot + path.sep));
});

test('resetBundlePublicDir removes only the public mount and keeps webpack output', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kiseki-bundle-out-'));
  fs.writeFileSync(path.join(dir, 'index.html'), 'keep');
  fs.mkdirSync(path.join(dir, 'public'));
  fs.writeFileSync(path.join(dir, 'public', 'photo.jpg'), 'img');
  resetBundlePublicDir(dir);
  assert.equal(fs.readFileSync(path.join(dir, 'index.html'), 'utf8'), 'keep');
  assert.equal(fs.existsSync(path.join(dir, 'public')), false);
});

test('persisted bundle writes into the cache dir and cleanup keeps webpack output', async () => {
  const runtime = makeRuntime();
  const seen = [];
  const bundled = await bundleRenderer('/album', {
    runtime,
    bundle: stubBundle((args) => seen.push(args)),
  });
  const expected = remotionBundleCacheDir(runtime, runtime.rendererRoot);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].outDir, expected);
  assert.equal(seen[0].publicDir, '/album');
  assert.equal(seen[0].symlinkPublicDir, true);
  assert.equal(bundled.bundleDir, expected);
  assert.ok(fs.existsSync(path.join(expected, 'index.html')));
  bundled.cleanup();
  assert.ok(fs.existsSync(path.join(expected, 'index.html')));
  assert.equal(fs.existsSync(path.join(expected, 'public')), false);
});

test('a leftover public symlink is removed before the next bundle', async () => {
  const runtime = makeRuntime();
  const cacheDir = remotionBundleCacheDir(runtime, runtime.rendererRoot);
  fs.mkdirSync(cacheDir, {recursive: true});
  fs.symlinkSync('/old/album', path.join(cacheDir, 'public'));
  let publicExisted = null;
  await bundleRenderer('/new/album', {
    runtime,
    bundle: stubBundle((args) => {
      publicExisted = fs.existsSync(path.join(args.outDir, 'public'));
    }),
  });
  assert.equal(publicExisted, false);
});

test('persist=false still deletes the whole temporary bundle on cleanup', async () => {
  const runtime = makeRuntime();
  const bundled = await bundleRenderer('/album', {
    runtime,
    persist: false,
    bundle: stubBundle(),
  });
  assert.ok(bundled.bundleDir);
  assert.ok(fs.existsSync(path.join(bundled.bundleDir, 'index.html')));
  bundled.cleanup();
  assert.equal(fs.existsSync(bundled.bundleDir), false);
});
