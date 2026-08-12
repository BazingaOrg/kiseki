import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {AssetMutationError, clearRecognizedLyrics, mutateAsset, undoAssetDelete} from './assets.mjs';
import {ProjectBusyError} from '../task-lease.mjs';

const fixture = () => fs.mkdtempSync(path.join(os.tmpdir(), 'kiseki-assets-'));
const leaseManager = () => ({acquire: () => ({}), release: () => true});
const macOSVarAlias = (folder) => {
  const canonical = fs.realpathSync(folder);
  const alias = canonical.replace(/^\/private\/var\//, '/var/');
  return alias !== canonical && fs.realpathSync(alias) === canonical ? alias : null;
};

const writeDerived = (folder) => {
  const metadata = path.join(folder, 'output', 'metadata');
  fs.mkdirSync(metadata, {recursive: true});
  for (const name of ['timeline.json', 'analysis.json', 'beats.json', 'lyrics.json']) fs.writeFileSync(path.join(metadata, name), name);
};

test('delete permanently removes paired lyrics, derived metadata, and the temporary transaction', () => {
  const folder = fixture();
  try {
    fs.writeFileSync(path.join(folder, 'song.mp3'), 'audio');
    fs.writeFileSync(path.join(folder, 'song.lrc'), 'lyrics');
    writeDerived(folder);
    const result = mutateAsset({folder, assetId: 'audio:song.mp3', action: 'delete', leaseManager: leaseManager()});
    assert.deepEqual(result, {});
    assert.equal(fs.existsSync(path.join(folder, 'song.mp3')), false);
    assert.equal(fs.existsSync(path.join(folder, 'song.lrc')), false);
    assert.equal(fs.existsSync(path.join(folder, 'output', 'metadata', 'analysis.json')), false);
    assert.equal(fs.existsSync(path.join(folder, '.kiseki-trash')), false);
  } finally {
    fs.rmSync(folder, {recursive: true, force: true});
  }
});

test('lyrics can be renamed or deleted and only lyrics-dependent timeline is invalidated', () => {
  const folder = fixture();
  try {
    fs.writeFileSync(path.join(folder, 'song.mp3'), 'audio');
    fs.writeFileSync(path.join(folder, 'song.lrc'), '[00:00.00]lyrics');
    writeDerived(folder);
    mutateAsset({folder, assetId: 'lyrics:song.lrc', action: 'rename', stem: 'edited', leaseManager: leaseManager()});
    assert.equal(fs.existsSync(path.join(folder, 'edited.lrc')), true);
    assert.equal(fs.existsSync(path.join(folder, 'output', 'metadata', 'timeline.json')), false);
    assert.equal(fs.existsSync(path.join(folder, 'output', 'metadata', 'analysis.json')), true);
    assert.equal(fs.existsSync(path.join(folder, 'output', 'metadata', 'beats.json')), true);
    assert.equal(fs.existsSync(path.join(folder, 'output', 'metadata', 'lyrics.json')), true);
    mutateAsset({folder, assetId: 'lyrics:edited.lrc', action: 'delete', leaseManager: leaseManager()});
    assert.equal(fs.existsSync(path.join(folder, 'edited.lrc')), false);
    assert.equal(fs.existsSync(path.join(folder, '.kiseki-trash')), false);
  } finally {
    fs.rmSync(folder, {recursive: true, force: true});
  }
});

test('rename updates per-photo config and permanently invalidates derived metadata', () => {
  const folder = fixture();
  try {
    fs.writeFileSync(path.join(folder, 'photo.jpg'), 'photo');
    fs.writeFileSync(path.join(folder, 'kiseki.json'), JSON.stringify({perPhoto: {'photo.jpg': {filter: 'mono'}}}));
    writeDerived(folder);
    mutateAsset({folder, assetId: 'photo:photo.jpg', action: 'rename', stem: 'renamed', leaseManager: leaseManager()});
    assert.equal(fs.existsSync(path.join(folder, 'photo.jpg')), false);
    assert.equal(fs.existsSync(path.join(folder, 'renamed.jpg')), true);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(folder, 'kiseki.json'), 'utf8')).perPhoto, {'renamed.jpg': {filter: 'mono'}});
    assert.equal(fs.existsSync(path.join(folder, 'output', 'metadata', 'timeline.json')), false);
    assert.equal(fs.existsSync(path.join(folder, '.kiseki-trash')), false);
  } finally {
    fs.rmSync(folder, {recursive: true, force: true});
  }
});

test('audio rename permanently keeps its paired lyrics in sync', () => {
  const folder = fixture();
  try {
    fs.writeFileSync(path.join(folder, 'song.mp3'), 'audio');
    fs.writeFileSync(path.join(folder, 'song.lrc'), 'lyrics');
    writeDerived(folder);
    mutateAsset({folder, assetId: 'audio:song.mp3', action: 'rename', stem: 'renamed', leaseManager: leaseManager()});
    assert.equal(fs.readFileSync(path.join(folder, 'renamed.mp3'), 'utf8'), 'audio');
    assert.equal(fs.readFileSync(path.join(folder, 'renamed.lrc'), 'utf8'), 'lyrics');
    assert.equal(fs.existsSync(path.join(folder, 'output', 'metadata', 'analysis.json')), false);
    assert.equal(fs.existsSync(path.join(folder, '.kiseki-trash')), false);
  } finally {
    fs.rmSync(folder, {recursive: true, force: true});
  }
});

test('delete rolls back when the transaction lease cannot be released', () => {
  const folder = fixture();
  try {
    fs.writeFileSync(path.join(folder, 'photo.jpg'), 'photo');
    assert.throws(() => mutateAsset({folder, assetId: 'photo:photo.jpg', action: 'delete', leaseManager: {acquire: () => ({}), release: () => false}}), /租约|lease/);
    assert.equal(fs.existsSync(path.join(folder, 'photo.jpg')), true);
    assert.equal(fs.existsSync(path.join(folder, '.kiseki-trash')), false);
  } finally {
    fs.rmSync(folder, {recursive: true, force: true});
  }
});

test('clear recognized lyrics moves only recognized and lyrics-dependent metadata, then undo restores all', () => {
  const folder = fixture();
  try {
    writeDerived(folder);
    fs.writeFileSync(path.join(folder, 'output', 'metadata', 'lyrics.json'), JSON.stringify({segments: [{text: 'line', start: 0, end: 1}]}));
    const {undoId} = clearRecognizedLyrics({folder, leaseManager: leaseManager()});
    assert.equal(fs.existsSync(path.join(folder, 'output', 'metadata', 'lyrics.json')), false);
    assert.equal(fs.existsSync(path.join(folder, 'output', 'metadata', 'timeline.json')), false);
    assert.equal(fs.existsSync(path.join(folder, 'output', 'metadata', 'analysis.json')), true);
    assert.equal(fs.existsSync(path.join(folder, 'output', 'metadata', 'beats.json')), true);
    undoAssetDelete({folder, undoId, leaseManager: leaseManager()});
    assert.equal(fs.existsSync(path.join(folder, 'output', 'metadata', 'lyrics.json')), true);
    assert.equal(fs.existsSync(path.join(folder, 'output', 'metadata', 'timeline.json')), true);
  } finally { fs.rmSync(folder, {recursive: true, force: true}); }
});

test('clear rolls back files and removes its operation when lease release fails', () => {
  const folder = fixture();
  try {
    writeDerived(folder);
    const metadata = path.join(folder, 'output', 'metadata');
    fs.writeFileSync(path.join(metadata, 'lyrics.json'), JSON.stringify({segments: [{text: 'line', start: 0}]}));
    assert.throws(() => clearRecognizedLyrics({folder, leaseManager: {acquire: () => ({}), release: () => false}}), /lease/);
    assert.equal(fs.existsSync(path.join(metadata, 'lyrics.json')), true);
    assert.equal(fs.existsSync(path.join(metadata, 'timeline.json')), true);
    assert.equal(fs.existsSync(path.join(folder, '.kiseki-trash')), false);
  } finally { fs.rmSync(folder, {recursive: true, force: true}); }
});

test('clear recognized lyrics fails closed for LRC, busy projects, and symlinked metadata', () => {
  const folder = fixture();
  try {
    writeDerived(folder);
    fs.writeFileSync(path.join(folder, 'output', 'metadata', 'lyrics.json'), JSON.stringify({segments: [{text: 'line', start: 0, end: 1}]}));
    fs.writeFileSync(path.join(folder, 'song.lrc'), '[00:00.00]line');
    assert.throws(() => clearRecognizedLyrics({folder, leaseManager: leaseManager()}), /LRC/);
    fs.rmSync(path.join(folder, 'song.lrc'));
    assert.throws(() => clearRecognizedLyrics({folder, isJobRunning: () => true, leaseManager: leaseManager()}), /任务运行中/);
    const lyrics = path.join(folder, 'output', 'metadata', 'lyrics.json');
    fs.renameSync(lyrics, `${lyrics}.real`);
    fs.symlinkSync(`${lyrics}.real`, lyrics);
    assert.throws(() => clearRecognizedLyrics({folder, leaseManager: leaseManager()}), /不安全/);
  } finally { fs.rmSync(folder, {recursive: true, force: true}); }
});

test('clear recognized lyrics undo fails closed when a destination was recreated', () => {
  const folder = fixture();
  try {
    writeDerived(folder);
    const metadata = path.join(folder, 'output', 'metadata');
    fs.writeFileSync(path.join(metadata, 'lyrics.json'), JSON.stringify({segments: [{text: 'line', start: 0, end: 1}]}));
    const {undoId} = clearRecognizedLyrics({folder, leaseManager: leaseManager()});
    fs.writeFileSync(path.join(metadata, 'lyrics.json'), 'new result');
    assert.throws(() => undoAssetDelete({folder, undoId, leaseManager: leaseManager()}), /回收记录/);
    assert.equal(fs.readFileSync(path.join(metadata, 'lyrics.json'), 'utf8'), 'new result');
  } finally { fs.rmSync(folder, {recursive: true, force: true}); }
});

test('undo preflights every recovery entry before moving any file, including symlink/type and parent drift', () => {
  const folder = fixture();
  try {
    writeDerived(folder);
    const metadata = path.join(folder, 'output', 'metadata');
    fs.writeFileSync(path.join(metadata, 'lyrics.json'), JSON.stringify({segments: [{text: 'line', start: 0}]}));
    const {undoId} = clearRecognizedLyrics({folder, leaseManager: leaseManager()});
    const operation = path.join(folder, '.kiseki-trash', undoId);
    const bad = path.join(operation, 'files', 'output', 'metadata', 'timeline.json');
    fs.rmSync(bad);
    fs.mkdirSync(bad);
    assert.throws(() => undoAssetDelete({folder, undoId, leaseManager: leaseManager()}), AssetMutationError);
    assert.equal(fs.existsSync(path.join(operation, 'files', 'output', 'metadata', 'lyrics.json')), true, 'first entry was not moved before full preflight');

    fs.rmSync(bad, {recursive: true});
    fs.symlinkSync(path.join(folder, 'outside'), bad);
    assert.throws(() => undoAssetDelete({folder, undoId, leaseManager: leaseManager()}), /回收记录/);
  } finally { fs.rmSync(folder, {recursive: true, force: true}); }
});

test('undo rejects mixed entries and canonical project/trash parent drift before any rename', () => {
  for (const drift of ['mixed', 'project-parent', 'trash-parent']) {
    const folder = fixture();
    try {
      writeDerived(folder);
      const metadata = path.join(folder, 'output', 'metadata');
      fs.writeFileSync(path.join(metadata, 'lyrics.json'), JSON.stringify({segments: [{text: 'line', start: 0}]}));
      const {undoId} = clearRecognizedLyrics({folder, leaseManager: leaseManager()});
      const operation = path.join(folder, '.kiseki-trash', undoId);
      if (drift === 'mixed') fs.writeFileSync(path.join(metadata, 'lyrics.json'), 'new');
      if (drift === 'project-parent') {
        const outside = path.join(folder, 'outside');
        fs.mkdirSync(path.join(outside, 'metadata'), {recursive: true});
        fs.renameSync(path.join(folder, 'output'), path.join(folder, 'output.real'));
        fs.symlinkSync(outside, path.join(folder, 'output'));
      }
      if (drift === 'trash-parent') {
        const files = path.join(operation, 'files', 'output');
        fs.renameSync(files, `${files}.real`);
        fs.symlinkSync(`${files}.real`, files);
      }
      assert.throws(() => undoAssetDelete({folder, undoId, leaseManager: leaseManager()}), AssetMutationError, drift);
      assert.equal(fs.existsSync(path.join(operation, 'files', 'output', 'metadata', 'lyrics.json')), true, drift);
    } finally { fs.rmSync(folder, {recursive: true, force: true}); }
  }
});

test('retained lease reconciles a compensated mixed recovery on the next undo', () => {
  const folder = fixture();
  const originalRename = fs.renameSync;
  let failRestore = true;
  let releases = 0;
  try {
    writeDerived(folder);
    const metadata = path.join(folder, 'output', 'metadata');
    fs.writeFileSync(path.join(metadata, 'lyrics.json'), JSON.stringify({segments: [{text: 'line', start: 0}]}));
    fs.renameSync = (from, to) => {
      if (failRestore && String(from).includes('.kiseki-trash') && String(to).endsWith('lyrics.json')) throw new Error('restore fails');
      return originalRename(from, to);
    };
    let undoId = '';
    assert.throws(
      () => clearRecognizedLyrics({folder, leaseManager: {acquire: () => ({id: 'held'}), release: () => ++releases > 1, verifyLeaseOwnership: () => true}}),
      (error) => {
        if (!(error instanceof AssetMutationError) || typeof error.details?.recoveryUndoId !== 'string' || error.details.recoveryRequired !== true) return false;
        undoId = error.details.recoveryUndoId;
        return true;
      },
    );
    assert.equal(releases, 1, 'failed release remains held for recovery');
    failRestore = false;
    const trashedLyrics = path.join(folder, '.kiseki-trash', undoId, 'files', 'output', 'metadata', 'lyrics.json');
    originalRename(trashedLyrics, path.join(metadata, 'lyrics.json'));
    const result = undoAssetDelete({folder, undoId, leaseManager: {acquire: () => { throw new Error('must not acquire'); }, release: () => false}});
    assert.equal(result.restored, 1);
    assert.equal(releases, 2, 'same retained lease was authoritatively released after reconcile');
    assert.equal(fs.existsSync(path.join(metadata, 'lyrics.json')), true);
    assert.equal(fs.existsSync(path.join(metadata, 'timeline.json')), true);
  } finally { fs.renameSync = originalRename; fs.rmSync(folder, {recursive: true, force: true}); }
});

test('retained recovery lease accepts the macOS /var alias for the same project', {skip: !macOSVarAlias(os.tmpdir())}, () => {
  const canonicalFolder = fixture();
  const folder = macOSVarAlias(canonicalFolder);
  const originalRename = fs.renameSync;
  let failRestore = true;
  let releases = 0;
  try {
    writeDerived(folder);
    const metadata = path.join(folder, 'output', 'metadata');
    fs.writeFileSync(path.join(metadata, 'lyrics.json'), JSON.stringify({segments: [{text: 'line', start: 0, end: 1}]}));
    fs.renameSync = (from, to) => {
      if (failRestore && String(from).includes('.kiseki-trash') && String(to).endsWith('lyrics.json')) throw new Error('restore fails');
      return originalRename(from, to);
    };
    let undoId = '';
    assert.throws(() => clearRecognizedLyrics({folder, leaseManager: {acquire: () => ({id: 'held'}), release: () => ++releases > 1, verifyLeaseOwnership: () => true}}), (error) => {
      undoId = error instanceof AssetMutationError ? error.details?.recoveryUndoId ?? '' : '';
      return Boolean(undoId);
    });
    failRestore = false;
    const trashedLyrics = path.join(folder, '.kiseki-trash', undoId, 'files', 'output', 'metadata', 'lyrics.json');
    originalRename(trashedLyrics, path.join(metadata, 'lyrics.json'));
    assert.equal(undoAssetDelete({folder, undoId, leaseManager: {acquire: () => { throw new Error('must not acquire'); }, release: () => false}}).restored, 1);
    assert.equal(releases, 2);
  } finally { fs.renameSync = originalRename; fs.rmSync(canonicalFolder, {recursive: true, force: true}); }
});

test('unverified retained lease acquires fresh authority, while a busy fresh acquire retains recovery id', () => {
  const folder = fixture();
  const originalRename = fs.renameSync;
  let failRestore = true;
  let oldReleases = 0;
  try {
    writeDerived(folder);
    const metadata = path.join(folder, 'output', 'metadata');
    fs.writeFileSync(path.join(metadata, 'lyrics.json'), JSON.stringify({segments: [{text: 'line', start: 0}]}));
    fs.renameSync = (from, to) => {
      if (failRestore && String(from).includes('.kiseki-trash') && String(to).endsWith('lyrics.json')) throw new Error('restore fails');
      return originalRename(from, to);
    };
    let undoId = '';
    const oldManager = {acquire: () => ({id: 'old'}), release: () => ++oldReleases > 1, verifyLeaseOwnership: () => false};
    assert.throws(() => clearRecognizedLyrics({folder, leaseManager: oldManager}), (error) => {
      undoId = error instanceof AssetMutationError ? error.details?.recoveryUndoId ?? '' : '';
      return Boolean(undoId);
    });
    failRestore = false;
    const fresh = {acquires: 0, releases: 0, acquire: () => ({id: 'fresh'}), release: () => true};
    const result = undoAssetDelete({folder, undoId, leaseManager: {...fresh, acquire: () => { fresh.acquires += 1; return {id: 'fresh'}; }, release: () => { fresh.releases += 1; return true; }}});
    assert.equal(result.restored, 2);
    assert.equal(fresh.acquires, 1);
    assert.equal(fresh.releases, 1);
    assert.equal(oldReleases, 1, 'stale ownership never retries its old release');

    failRestore = true;
    fs.writeFileSync(path.join(metadata, 'lyrics.json'), JSON.stringify({segments: [{text: 'again', start: 0}]}));
    let busyUndoId = '';
    const secondOldManager = {acquire: () => ({id: 'old-2'}), release: () => false, verifyLeaseOwnership: () => false};
    assert.throws(() => clearRecognizedLyrics({folder, leaseManager: secondOldManager}), (error) => {
      busyUndoId = error instanceof AssetMutationError ? error.details?.recoveryUndoId ?? '' : '';
      return Boolean(busyUndoId);
    });
    failRestore = false;
    assert.throws(
      () => undoAssetDelete({folder, undoId: busyUndoId, leaseManager: {acquire: () => { throw new ProjectBusyError(); }, release: () => true}}),
      (error) => error instanceof AssetMutationError && error.details?.recoveryUndoId === busyUndoId,
    );
  } finally { fs.renameSync = originalRename; fs.rmSync(folder, {recursive: true, force: true}); }
});
