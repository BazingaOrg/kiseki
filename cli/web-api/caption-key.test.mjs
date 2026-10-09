import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {captionKeyConfigured, saveCaptionKey} from './caption-key.mjs';
import {loadLocalEnv, parseEnvFile} from '../load-env.mjs';

test('saveCaptionKey writes a gitignored env file and applies it immediately', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kiseki-key-'));
  const envPath = path.join(dir, '.env');
  const env = {};
  fs.writeFileSync(envPath, 'OTHER=1\nDEEPSEEK_API_KEY=old\n');
  const result = saveCaptionKey({key: ' sk-new ', envPath, env});
  assert.deepEqual(result, {configured: true});
  assert.equal(env.DEEPSEEK_API_KEY, 'sk-new');
  assert.equal(parseEnvFile(fs.readFileSync(envPath, 'utf8')).DEEPSEEK_API_KEY, 'sk-new');
  assert.match(fs.readFileSync(envPath, 'utf8'), /OTHER=1/);
  assert.equal(captionKeyConfigured(env), true);
});

test('desktop caption key is stored in app data', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kiseki-key-app-'));
  const env = {KISEKI_DESKTOP: '1', KISEKI_DATA_ROOT: dir};
  saveCaptionKey({key: 'sk-desk', env});
  assert.equal(parseEnvFile(fs.readFileSync(path.join(dir, '.env'), 'utf8')).DEEPSEEK_API_KEY, 'sk-desk');
  const loaded = {KISEKI_DESKTOP: '1', KISEKI_DATA_ROOT: dir};
  loadLocalEnv({env: loaded});
  assert.equal(loaded.DEEPSEEK_API_KEY, 'sk-desk');
});

test('saveCaptionKey rejects an empty or multiline key', () => {
  assert.throws(() => saveCaptionKey({key: '  ', envPath: path.join(os.tmpdir(), 'missing.env'), env: {}}), /请填写密钥/);
  assert.throws(() => saveCaptionKey({key: 'sk\nsecret', envPath: path.join(os.tmpdir(), 'missing.env'), env: {}}), /格式不正确/);
});
