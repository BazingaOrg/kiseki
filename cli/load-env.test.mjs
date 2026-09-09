import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {applyLocalEnv, loadLocalEnv, parseEnvFile, repoEnvPath} from './load-env.mjs';

test('repo env file sits at the workspace root, not the photo folder', () => {
  const envPath = repoEnvPath();
  assert.equal(path.basename(envPath), '.env');
  assert.ok(fs.existsSync(path.join(path.dirname(envPath), 'cli', 'kiseki.mjs')));
});

test('parseEnvFile reads DEEPSEEK_API_KEY and ignores other keys', () => {
  assert.deepEqual(
    parseEnvFile([
      '# comment',
      'KISEKI_CONCURRENCY=8',
      'DEEPSEEK_API_KEY=sk-test',
      'export DEEPSEEK_API_KEY="sk-quoted"',
      "DEEPSEEK_API_KEY='sk-single'",
    ].join('\n')),
    {DEEPSEEK_API_KEY: 'sk-single'},
  );
});

test('applyLocalEnv does not override a non-empty process env', () => {
  const env = {DEEPSEEK_API_KEY: 'from-shell'};
  applyLocalEnv({DEEPSEEK_API_KEY: 'from-file'}, env);
  assert.equal(env.DEEPSEEK_API_KEY, 'from-shell');
});

test('loadLocalEnv fills an empty key from the file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kiseki-env-'));
  try {
    const envPath = path.join(dir, '.env');
    fs.writeFileSync(envPath, 'DEEPSEEK_API_KEY=sk-from-file\n');
    const env = {DEEPSEEK_API_KEY: ''};
    loadLocalEnv({envPath, env});
    assert.equal(env.DEEPSEEK_API_KEY, 'sk-from-file');
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
  }
});

test('missing env file is a no-op', () => {
  const env = {};
  loadLocalEnv({envPath: path.join(os.tmpdir(), 'kiseki-missing.env'), env});
  assert.equal(env.DEEPSEEK_API_KEY, undefined);
});
