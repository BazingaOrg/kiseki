import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {prepareAnalyzerRuntime} from '../src/analyzer-runtime.mjs';

test('analyzer runtime marks only a successful offline sync complete', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kiseki-analyzer-runtime-'));
  const analyzerRoot = path.join(root, 'analyzer'); fs.mkdirSync(analyzerRoot); fs.writeFileSync(path.join(analyzerRoot, 'uv.lock'), 'lock');
  const runtime = {analyzerEnvRoot: path.join(root, 'env'), analyzerRoot, wheelhouseRoot: '/wheels', uv: '/uv', python: '/python'};
  let calls = 0;
  prepareAnalyzerRuntime(runtime, {spawn: (_cmd, args, options) => { calls += 1; assert.ok(args.includes('--offline')); assert.equal(options.env.UV_NO_INDEX, '1'); fs.mkdirSync(runtime.analyzerEnvRoot); return {status: 0}; }});
  prepareAnalyzerRuntime(runtime, {spawn: () => { throw new Error('must not rerun'); }});
  assert.equal(calls, 1);
  fs.rmSync(root, {recursive: true});
});

test('failed analyzer install removes partial environment', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kiseki-analyzer-runtime-'));
  const analyzerRoot = path.join(root, 'analyzer'); fs.mkdirSync(analyzerRoot); fs.writeFileSync(path.join(analyzerRoot, 'uv.lock'), 'lock');
  const runtime = {analyzerEnvRoot: path.join(root, 'env'), analyzerRoot, wheelhouseRoot: '/wheels', uv: '/uv', python: '/python'};
  assert.throws(() => prepareAnalyzerRuntime(runtime, {spawn: () => { fs.mkdirSync(runtime.analyzerEnvRoot); return {status: 1, stderr: 'bad wheel'}; }}), /bad wheel/);
  assert.equal(fs.existsSync(runtime.analyzerEnvRoot), false);
  fs.rmSync(root, {recursive: true});
});
