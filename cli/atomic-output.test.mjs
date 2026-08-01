import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {commitAtomicOutput, createPartialOutput, installAtomicOutputs, isAtomicPartialName, outputArtifactPaths, removePartialOutput, resolveAtomicTaskId} from './atomic-output.mjs';

const fixture = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tsuzuri-atomic-output-'));

test('partial output stays beside final output and preserves its extension', () => {
  const partial = createPartialOutput('/tmp/album/output/movie.mp4', 'lease-1');
  assert.equal(partial, '/tmp/album/output/.tsuzuri-partial-lease-1-movie.mp4');
  assert.equal(isAtomicPartialName(path.basename(partial)), true);
});

test('partial and backup are both derivable from the task id and final output', () => {
  assert.deepEqual(outputArtifactPaths('/tmp/album/output/movie.mp4', 'lease-1'), {
    finalPath: '/tmp/album/output/movie.mp4',
    partialPath: '/tmp/album/output/.tsuzuri-partial-lease-1-movie.mp4',
    backupPath: '/tmp/album/output/.tsuzuri-backup-lease-1-movie.mp4',
  });
});

test('lease task id wins and direct calls generate an id', () => {
  assert.equal(resolveAtomicTaskId({env: {TSUZURI_TASK_ID: 'lease-1'}, randomUUID: () => 'random'}), 'lease-1');
  assert.equal(resolveAtomicTaskId({env: {TSUZURI_TASK_ID: 'legacy', TSUZURI_LEASE_TASK_ID: 'lease-1'}, randomUUID: () => 'random'}), 'lease-1');
  assert.equal(resolveAtomicTaskId({env: {}, randomUUID: () => 'random'}), 'random');
});

test('commit replaces an existing final through same-directory rename', () => {
  const dir = fixture();
  try {
    const finalPath = path.join(dir, 'movie.mp4');
    const partial = createPartialOutput(finalPath, 'lease-1');
    fs.writeFileSync(finalPath, 'old');
    fs.writeFileSync(partial, 'new');
    commitAtomicOutput(finalPath, partial, {taskId: 'lease-1'});
    assert.equal(fs.readFileSync(finalPath, 'utf8'), 'new');
    assert.equal(fs.existsSync(partial), false);
    assert.deepEqual(fs.readdirSync(dir), ['movie.mp4']);
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
  }
});

test('commit rejects directory and symlink finals before mutating either target', () => {
  const dir = fixture();
  try {
    const directoryFinal = path.join(dir, 'directory.mp4');
    const linkFinal = path.join(dir, 'link.mp4');
    const target = path.join(dir, 'target.mp4');
    fs.mkdirSync(directoryFinal);
    fs.writeFileSync(target, 'old');
    fs.symlinkSync(target, linkFinal);
    for (const finalPath of [directoryFinal, linkFinal]) {
      const partial = createPartialOutput(finalPath, 'lease-1');
      fs.writeFileSync(partial, 'new');
      assert.throws(() => commitAtomicOutput(finalPath, partial, {taskId: 'lease-1'}), /普通文件/);
      assert.equal(fs.readFileSync(partial, 'utf8'), 'new');
    }
    assert.equal(fs.readFileSync(target, 'utf8'), 'old');
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});

test('partial cleanup only removes a generated partial path', () => {
  const dir = fixture();
  try {
    const partial = createPartialOutput(path.join(dir, 'still.png'), 'lease-1');
    fs.writeFileSync(partial, 'partial');
    removePartialOutput(partial);
    assert.equal(fs.existsSync(partial), false);
    assert.throws(() => removePartialOutput(path.join(dir, 'still.png')), /不是 tsuzuri partial/);
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
  }
});

test('group install stages every file before replacing or deleting any final', () => {
  const dir = fixture();
  try {
    const oldAudio = path.join(dir, 'old.m4a');
    const nextAudio = path.join(dir, 'next.m4a');
    const lyrics = path.join(dir, 'next.lrc');
    fs.writeFileSync(oldAudio, 'old');
    installAtomicOutputs({
      taskId: 'lease-1',
      writes: [{finalPath: nextAudio, contents: 'audio'}, {finalPath: lyrics, contents: 'lyrics'}],
      deletes: [oldAudio],
    });
    assert.equal(fs.existsSync(oldAudio), false);
    assert.equal(fs.readFileSync(nextAudio, 'utf8'), 'audio');
    assert.equal(fs.readFileSync(lyrics, 'utf8'), 'lyrics');
    assert.deepEqual(fs.readdirSync(dir).sort(), ['next.lrc', 'next.m4a']);
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
  }
});

test('a committed transaction keeps new outputs when finalize cleanup fails', () => {
  const dir = fixture();
  try {
    const finalPath = path.join(dir, 'movie.mp4');
    const {backupPath} = outputArtifactPaths(finalPath, 'lease-1');
    const calls = [];
    fs.writeFileSync(finalPath, 'old');
    assert.throws(() => installAtomicOutputs({
      taskId: 'lease-1',
      writes: [{finalPath, contents: 'new'}],
      transaction: {
        prepare: () => calls.push('prepare'),
        markCommitting: () => calls.push('committing'),
        markCommitted: () => calls.push('committed'),
        rollback: () => calls.push('rollback'),
        finalize: () => { calls.push('finalize'); throw new Error('cleanup failed'); },
      },
    }), /cleanup failed/);
    assert.deepEqual(calls, ['prepare', 'committing', 'committed', 'finalize']);
    assert.equal(fs.readFileSync(finalPath, 'utf8'), 'new');
    assert.equal(fs.readFileSync(backupPath, 'utf8'), 'old');
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
  }
});
