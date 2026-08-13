import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {spawnSync} from 'node:child_process';

import {createRuntimeLayout, runtimeLayoutEnv, sourceRuntimeLayout} from './runtime-layout.mjs';

test('source runtime layout resolves independently of cwd', () => {
  assert.equal(path.basename(sourceRuntimeLayout.cliEntry), 'kiseki.mjs');
  assert.equal(path.basename(sourceRuntimeLayout.analyzerRoot), 'analyzer');
  assert.equal(path.basename(sourceRuntimeLayout.rendererRoot), 'renderer');
  assert.equal(path.basename(sourceRuntimeLayout.webDist), 'dist');
  assert.equal(sourceRuntimeLayout.ffmpeg, 'ffmpeg');
  assert.equal(sourceRuntimeLayout.modelRoot, path.join(path.dirname(sourceRuntimeLayout.cliEntry), '..', 'models'));
});

test('runtime layout accepts explicit paths containing spaces', () => {
  const root = path.join(os.tmpdir(), 'kiseki runtime with spaces');
  const layout = createRuntimeLayout({
    sourceRoot: root,
    ffmpeg: path.join(root, 'bin', 'ffmpeg tool'),
    cacheRoot: path.join(root, 'user cache'),
  });
  assert.equal(layout.cliEntry, path.join(root, 'cli', 'kiseki.mjs'));
  assert.equal(layout.ffmpeg, path.join(root, 'bin', 'ffmpeg tool'));
  assert.equal(layout.modelRoot, path.join(root, 'user cache', 'models'));
});

test('runtime layout preserves PATH command names and rejects missing overrides', () => {
  assert.equal(createRuntimeLayout({ytDlp: 'custom-ytdlp'}).ytDlp, 'custom-ytdlp');
  assert.throws(() => createRuntimeLayout({curl: ''}), /RuntimeLayout\.curl/);
});

test('runtime layout serializes safely for child processes', () => {
  const runtime = createRuntimeLayout({sourceRoot: path.join(os.tmpdir(), 'child runtime'), ffmpeg: '/tools with spaces/ffmpeg'});
  const serialized = runtimeLayoutEnv(runtime).KISEKI_RUNTIME_LAYOUT;
  assert.deepEqual(createRuntimeLayout(JSON.parse(serialized)), runtime);
});

test('child process restores runtime layout from env and rejects malformed values', () => {
  const runtime = createRuntimeLayout({sourceRoot: path.join(os.tmpdir(), 'child env runtime')});
  const moduleUrl = new URL('./runtime-layout.mjs', import.meta.url).href;
  const ok = spawnSync(process.execPath, ['--input-type=module', '-e', `import {sourceRuntimeLayout} from ${JSON.stringify(moduleUrl)}; process.stdout.write(sourceRuntimeLayout.cliEntry)`], {
    encoding: 'utf8',
    env: {...process.env, ...runtimeLayoutEnv(runtime)},
  });
  assert.equal(ok.status, 0);
  assert.equal(ok.stdout, runtime.cliEntry);
  for (const malformed of ['', '{', '[]', 'null']) {
    const failed = spawnSync(process.execPath, ['--input-type=module', '-e', `import ${JSON.stringify(moduleUrl)}`], {
      encoding: 'utf8', env: {...process.env, KISEKI_RUNTIME_LAYOUT: malformed},
    });
    assert.notEqual(failed.status, 0);
    assert.match(failed.stderr, /KISEKI_RUNTIME_LAYOUT/);
  }
});
