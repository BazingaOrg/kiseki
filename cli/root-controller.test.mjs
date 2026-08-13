import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {canonicalizeAuthorizedRoot, createImmutableRootController, createMutableRootController, createWriteActivityGate} from './root-controller.mjs';

test('controllers canonicalize directories and reject a symlink root', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kiseki-root-'));
  const link = `${root}-link`;
  fs.symlinkSync(root, link);
  assert.equal(createImmutableRootController(root).getSnapshot().path, fs.realpathSync(root));
  assert.throws(() => canonicalizeAuthorizedRoot(link), /符号链接|可授权/);
  fs.rmSync(link); fs.rmSync(root, {recursive: true});
});

test('mutable controller increments generations', () => {
  const a = fs.mkdtempSync(path.join(os.tmpdir(), 'kiseki-root-a-'));
  const b = fs.mkdtempSync(path.join(os.tmpdir(), 'kiseki-root-b-'));
  const controller = createMutableRootController({initialRoot: a});
  assert.equal(controller.getSnapshot().generation, 0);
  assert.equal(controller.setRoot(b).generation, 1);
  fs.rmSync(a, {recursive: true}); fs.rmSync(b, {recursive: true});
});

test('write gate releases idempotently', () => {
  const gate = createWriteActivityGate();
  const release = gate.enter(); assert.equal(gate.isBusy(), true);
  release(); release(); assert.equal(gate.isBusy(), false);
});

test('write gate waitForIdle resolves after every active writer releases', async () => {
  const gate = createWriteActivityGate();
  const releaseA = gate.enter(); const releaseB = gate.enter();
  let settled = false; const idle = gate.waitForIdle().then(() => { settled = true; });
  releaseA(); await Promise.resolve(); assert.equal(settled, false);
  releaseB(); await idle; assert.equal(settled, true);
});
