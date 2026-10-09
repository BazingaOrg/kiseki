import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {createNodeCommandResolver} from './command-resolver.mjs';
import {preparePackagedRuntime, shouldOpenWebBrowser} from './desktop-runtime.mjs';
import {createRuntimeLayout} from './runtime-layout.mjs';

test('packaged analyzer runs from the relocated environment', () => {
  const runtime = createRuntimeLayout({
    sourceRoot: '/runtime',
    bundledAnalyzer: true,
    analyzerEnvRoot: '/runtime/analyzer-env',
    ffmpeg: '/runtime/bin/ffmpeg',
    modelRoot: '/data/models',
  });
  const spec = createNodeCommandResolver({runtime, executable: '/runtime/node'}).analyzer('kiseki-plan', ['/album']);
  const script = process.platform === 'win32' ? 'Scripts\\kiseki-plan.exe' : 'bin/kiseki-plan';
  assert.equal(spec.executable, path.normalize(`/runtime/analyzer-env/${script}`));
  assert.deepEqual(spec.args, ['/album']);
  assert.equal(spec.env.VIRTUAL_ENV, '/runtime/analyzer-env');
  assert.equal(spec.env.KISEKI_FFMPEG_BIN, '/runtime/bin/ffmpeg');
});

const markRuntime = (root) => {
  for (const name of ['cli/kiseki.mjs', 'web/dist/index.html', 'analyzer/pyproject.toml', 'renderer/package.json']) {
    fs.mkdirSync(path.dirname(path.join(root, name)), {recursive: true});
    fs.writeFileSync(path.join(root, name), '');
  }
};

test('preparePackagedRuntime keeps downloads in app data and rewrites an existing virtualenv', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kiseki-desktop-'));
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'kiseki-data-'));
  markRuntime(root);
  const pythonDir = path.join(data, 'tools', 'python', 'cpython', 'bin');
  fs.mkdirSync(pythonDir, {recursive: true});
  fs.writeFileSync(path.join(pythonDir, 'python3'), '#!/bin/sh\n');
  fs.chmodSync(path.join(pythonDir, 'python3'), 0o755);
  const envBin = path.join(data, 'tools', 'analyzer-env', 'bin');
  fs.mkdirSync(envBin, {recursive: true});
  fs.writeFileSync(path.join(data, 'tools', 'analyzer-env', 'pyvenv.cfg'), 'home = /old/python/bin\nversion_info = 3.12.0\n');
  fs.writeFileSync(path.join(envBin, 'kiseki-plan'), '#!/old/python/bin/python3\nprint(1)\n');
  const runtime = preparePackagedRuntime(root, {dataRoot: data});
  assert.equal(runtime.bundledAnalyzer, true);
  assert.equal(runtime.ffmpeg, path.join(data, 'tools', 'bin', 'ffmpeg'));
  assert.equal(runtime.uv, path.join(data, 'tools', 'bin', 'uv'));
  assert.equal(runtime.analyzerEnvRoot, path.join(data, 'tools', 'analyzer-env'));
  assert.equal(fs.existsSync(path.join(root, 'python')), false);
  assert.equal(runtime.python, path.join(pythonDir, 'python3'));
  assert.match(fs.readFileSync(path.join(data, 'tools', 'analyzer-env', 'pyvenv.cfg'), 'utf8'), new RegExp(`home = ${pythonDir}`));
  assert.match(fs.readFileSync(path.join(envBin, 'kiseki-plan'), 'utf8'), new RegExp(`^#!${runtime.python}\\n`));
});

test('preparePackagedRuntime starts before any download exists', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kiseki-desktop-'));
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'kiseki-data-'));
  markRuntime(root);
  const runtime = preparePackagedRuntime(root, {dataRoot: data});
  assert.equal(runtime.bundledAnalyzer, true);
  assert.equal(runtime.analyzerRoot, path.join(root, 'analyzer'));
  assert.equal(fs.existsSync(runtime.ffmpeg), false);
});

test('desktop launch does not open the system browser', () => {
  assert.equal(shouldOpenWebBrowser(true, {}), true);
  assert.equal(shouldOpenWebBrowser(true, {KISEKI_OPEN_BROWSER: '0'}), false);
  assert.equal(shouldOpenWebBrowser(false, {}), false);
});
