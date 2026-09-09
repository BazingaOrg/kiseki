import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {readJsonFile, writeJsonAtomic} from './atomic-json.mjs';

const fixture = () => fs.mkdtempSync(path.join(os.tmpdir(), 'kiseki-atomic-json-'));

test('atomic json write replaces a complete file and leaves no partials', () => {
  const dir = fixture();
  const file = path.join(dir, 'ai-captions.json');
  try {
    writeJsonAtomic(file, {version: 1, items: {a: 1}});
    writeJsonAtomic(file, {version: 1, items: {a: 1, b: 2}});
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), {version: 1, items: {a: 1, b: 2}});
    const leftovers = fs.readdirSync(dir).filter((name) => name.startsWith('.kiseki-partial-'));
    assert.deepEqual(leftovers, []);
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
  }
});

test('failed rename keeps the previous complete file', () => {
  const dir = fixture();
  const file = path.join(dir, 'ai-captions.json');
  const original = fs.renameSync;
  try {
    writeJsonAtomic(file, {ok: true});
    fs.renameSync = () => { throw new Error('rename-blocked'); };
    assert.throws(() => writeJsonAtomic(file, {ok: false}), /rename-blocked/);
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), {ok: true});
    const leftovers = fs.readdirSync(dir).filter((name) => name.startsWith('.kiseki-partial-'));
    assert.deepEqual(leftovers, []);
  } finally {
    fs.renameSync = original;
    fs.rmSync(dir, {recursive: true, force: true});
  }
});

test('readJsonFile returns null for missing or damaged JSON', () => {
  const dir = fixture();
  try {
    assert.equal(readJsonFile(path.join(dir, 'missing.json')), null);
    const damaged = path.join(dir, 'damaged.json');
    fs.writeFileSync(damaged, '{not json');
    assert.equal(readJsonFile(damaged), null);
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
  }
});
