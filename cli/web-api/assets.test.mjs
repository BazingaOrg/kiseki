import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {mutateAsset, undoAssetDelete} from './assets.mjs';

const fixture = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tsuzuri-assets-'));
const leaseManager = () => ({acquire: () => ({}), release: () => {}});

const writeDerived = (folder) => {
  const metadata = path.join(folder, 'output', 'metadata');
  fs.mkdirSync(metadata, {recursive: true});
  for (const name of ['timeline.json', 'analysis.json', 'beats.json', 'lyrics.json']) fs.writeFileSync(path.join(metadata, name), name);
};

test('delete manifest and undo retain paired lyrics and derived metadata until full restore', () => {
  const folder = fixture();
  try {
    fs.writeFileSync(path.join(folder, 'song.mp3'), 'audio');
    fs.writeFileSync(path.join(folder, 'song.lrc'), 'lyrics');
    writeDerived(folder);
    const {undoId} = mutateAsset({folder, assetId: 'audio:song.mp3', action: 'delete', leaseManager: leaseManager()});
    const operation = path.join(folder, '.tsuzuri-trash', undoId);
    const manifest = JSON.parse(fs.readFileSync(path.join(operation, 'manifest.json'), 'utf8'));
    assert.equal(manifest.action, 'delete');
    assert.deepEqual(manifest.files.map(({from}) => from).sort(), ['song.lrc', 'song.mp3']);
    assert.deepEqual(manifest.derived.map(({from}) => from).sort(), [
      'output/metadata/analysis.json', 'output/metadata/beats.json', 'output/metadata/lyrics.json', 'output/metadata/timeline.json',
    ]);
    assert.equal(fs.existsSync(path.join(folder, 'song.mp3')), false);
    undoAssetDelete({folder, undoId, leaseManager: leaseManager()});
    assert.equal(fs.readFileSync(path.join(folder, 'song.mp3'), 'utf8'), 'audio');
    assert.equal(fs.readFileSync(path.join(folder, 'song.lrc'), 'utf8'), 'lyrics');
    assert.equal(fs.readFileSync(path.join(folder, 'output', 'metadata', 'analysis.json'), 'utf8'), 'analysis.json');
    assert.equal(fs.existsSync(path.join(folder, '.tsuzuri-trash')), false);
  } finally {
    fs.rmSync(folder, {recursive: true, force: true});
  }
});

test('rename uses one recoverable operation for file, per-photo config, and invalidated metadata', () => {
  const folder = fixture();
  try {
    fs.writeFileSync(path.join(folder, 'photo.jpg'), 'photo');
    fs.writeFileSync(path.join(folder, 'tsuzuri.json'), JSON.stringify({perPhoto: {'photo.jpg': {filter: 'mono'}}}));
    writeDerived(folder);
    const {undoId} = mutateAsset({folder, assetId: 'photo:photo.jpg', action: 'rename', stem: 'renamed', leaseManager: leaseManager()});
    const operation = path.join(folder, '.tsuzuri-trash', undoId);
    const manifest = JSON.parse(fs.readFileSync(path.join(operation, 'manifest.json'), 'utf8'));
    assert.equal(manifest.action, 'rename');
    assert.deepEqual(manifest.files, [{from: 'photo.jpg', to: 'renamed.jpg', storedInOperation: false}]);
    assert.deepEqual(manifest.config, {path: 'tsuzuri.json', backup: 'metadata/tsuzuri.json'});
    assert.equal(fs.existsSync(path.join(operation, 'derived', 'timeline.json')), true);
    undoAssetDelete({folder, undoId, leaseManager: leaseManager()});
    assert.equal(fs.existsSync(path.join(folder, 'photo.jpg')), true);
    assert.equal(fs.existsSync(path.join(folder, 'renamed.jpg')), false);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(folder, 'tsuzuri.json'), 'utf8')).perPhoto, {'photo.jpg': {filter: 'mono'}});
    assert.equal(fs.existsSync(path.join(folder, 'output', 'metadata', 'timeline.json')), true);
    assert.equal(fs.existsSync(path.join(folder, '.tsuzuri-trash')), false);
  } finally {
    fs.rmSync(folder, {recursive: true, force: true});
  }
});

test('rename undo restores paired lyrics from project paths and derived metadata from the operation', () => {
  const folder = fixture();
  try {
    fs.writeFileSync(path.join(folder, 'song.mp3'), 'audio');
    fs.writeFileSync(path.join(folder, 'song.lrc'), 'lyrics');
    writeDerived(folder);
    const {undoId} = mutateAsset({folder, assetId: 'audio:song.mp3', action: 'rename', stem: 'renamed', leaseManager: leaseManager()});
    const operation = path.join(folder, '.tsuzuri-trash', undoId);
    const manifest = JSON.parse(fs.readFileSync(path.join(operation, 'manifest.json'), 'utf8'));
    assert.deepEqual(manifest.files.map(({to, storedInOperation}) => ({to, storedInOperation})).sort((a, b) => a.to.localeCompare(b.to)), [
      {to: 'renamed.lrc', storedInOperation: false},
      {to: 'renamed.mp3', storedInOperation: false},
    ]);
    undoAssetDelete({folder, undoId, leaseManager: leaseManager()});
    assert.equal(fs.readFileSync(path.join(folder, 'song.mp3'), 'utf8'), 'audio');
    assert.equal(fs.readFileSync(path.join(folder, 'song.lrc'), 'utf8'), 'lyrics');
    assert.equal(fs.readFileSync(path.join(folder, 'output', 'metadata', 'analysis.json'), 'utf8'), 'analysis.json');
  } finally {
    fs.rmSync(folder, {recursive: true, force: true});
  }
});

test('undo keeps its record when cleanup finds an undeclared trash entry', () => {
  const folder = fixture();
  try {
    fs.writeFileSync(path.join(folder, 'photo.jpg'), 'photo');
    const {undoId} = mutateAsset({folder, assetId: 'photo:photo.jpg', action: 'delete', leaseManager: leaseManager()});
    const operation = path.join(folder, '.tsuzuri-trash', undoId);
    fs.writeFileSync(path.join(operation, 'unexpected.txt'), 'unexpected');
    assert.throws(() => undoAssetDelete({folder, undoId, leaseManager: leaseManager()}), /不能清理/);
    assert.equal(fs.existsSync(path.join(folder, 'photo.jpg')), true);
    assert.equal(fs.existsSync(operation), true);
  } finally {
    fs.rmSync(folder, {recursive: true, force: true});
  }
});
