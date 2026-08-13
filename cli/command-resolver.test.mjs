import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {createElectronCommandResolver, createNodeCommandResolver} from './command-resolver.mjs';
import {createRuntimeLayout} from './runtime-layout.mjs';

const runtime = createRuntimeLayout({sourceRoot: path.join(os.tmpdir(), 'runtime with spaces'), uv: '/tools with spaces/uv'});

test('node resolver creates structured CLI and analyzer command specs', () => {
  const resolver = createNodeCommandResolver({runtime, executable: '/node with spaces', baseEnv: {BASE: '1', KISEKI_MODEL_ROOT: '/ambient-models', KISEKI_FFMPEG_BIN: '/ambient-ffmpeg'}});
  const cli = resolver.cli(['help'], {env: {CALLER: '2'}, stdio: ['ignore', 'pipe', 'pipe', 'pipe']});
  assert.equal(cli.executable, '/node with spaces');
  assert.deepEqual(cli.args, [runtime.cliEntry, 'help']);
  assert.equal(cli.env.BASE, '1');
  assert.equal(cli.env.CALLER, '2');
  assert.deepEqual(cli.stdio, ['ignore', 'pipe', 'pipe', 'pipe']);
  const analyzer = resolver.analyzer('kiseki-plan', ['/album']);
  assert.deepEqual(analyzer.args, ['run', '--project', runtime.analyzerRoot, 'kiseki-plan', '/album']);
  assert.equal(analyzer.env.KISEKI_MODEL_ROOT, runtime.modelRoot);
  assert.equal(analyzer.env.KISEKI_FFMPEG_BIN, runtime.ffmpeg);
  assert.equal(resolver.analyzer('kiseki-plan', [], {env: {KISEKI_MODEL_ROOT: '/override'}}).env.KISEKI_MODEL_ROOT, '/override');
});

test('electron resolver forces run-as-node after caller env', () => {
  const resolver = createElectronCommandResolver({runtime, executable: '/Kiseki App', baseEnv: {}});
  const spec = resolver.cli([], {env: {ELECTRON_RUN_AS_NODE: '0'}});
  assert.equal(spec.executable, '/Kiseki App');
  assert.equal(spec.env.ELECTRON_RUN_AS_NODE, '1');
  assert.equal(resolver.renderer([]).env.ELECTRON_RUN_AS_NODE, '1');
  assert.equal(resolver.analyzer('kiseki-plan', []).env.ELECTRON_RUN_AS_NODE, undefined);
  assert.equal(resolver.tool('ytDlp', []).env.ELECTRON_RUN_AS_NODE, undefined);
});

test('offline analyzer specs use the prepared environment and bundled Python', () => {
  const offline = createRuntimeLayout({
    sourceRoot: '/runtime', analyzerOffline: true, analyzerEnvRoot: '/user/analyzer-env',
    wheelhouseRoot: '/runtime/wheels', python: '/runtime/python', modelRoot: '/user/models', ffmpeg: '/runtime/ffmpeg',
  });
  const spec = createElectronCommandResolver({runtime: offline, executable: '/Kiseki'}).analyzer('kiseki-analyze', []);
  assert.deepEqual(spec.args.slice(0, 3), ['run', '--offline', '--frozen']);
  assert.equal(spec.env.UV_PROJECT_ENVIRONMENT, '/user/analyzer-env');
  assert.equal(spec.env.UV_FIND_LINKS, '/runtime/wheels');
  assert.equal(spec.env.UV_PYTHON, '/runtime/python');
  assert.equal(spec.env.UV_NO_INDEX, '1');
  assert.equal(spec.env.KISEKI_MODEL_ROOT, '/user/models');
  assert.equal(spec.env.KISEKI_FFMPEG_BIN, '/runtime/ffmpeg');
});

test('tool resolver is allowlisted and preserves absolute commands with spaces', () => {
  const resolver = createNodeCommandResolver({runtime});
  assert.equal(resolver.tool('uv', ['--version']).executable, '/tools with spaces/uv');
  assert.throws(() => resolver.tool('shell', ['echo']), /未知 RuntimeLayout 工具/);
});
