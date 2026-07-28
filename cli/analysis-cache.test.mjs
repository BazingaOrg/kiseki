import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  ANALYSIS_CACHE_VERSION,
  computeAnalysisHash,
  hasValidAnalysisCache,
  readAnalysisFingerprint,
  readDemucsSetting,
  writeAnalysisManifest,
} from './analysis-cache.mjs';

const runtime = ({backend = 'mlx', model = 'medium', demucsAvailable = false, beatFeaturesVersion = 1} = {}) => JSON.stringify({
  version: 1,
  beat_features_version: beatFeaturesVersion,
  backend,
  model,
  demucs_available: demucsAvailable,
});

const makeProject = () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'tsuzuri-analysis-cache-'));
  const metadata = path.join(folder, 'metadata');
  fs.mkdirSync(metadata);
  fs.writeFileSync(path.join(folder, 'song.mp3'), 'audio');
  fs.writeFileSync(path.join(folder, 'lyrics.lrc'), '[00:01.00]line');
  fs.writeFileSync(path.join(metadata, 'beats.json'), '{"version":1}');
  fs.writeFileSync(path.join(metadata, 'lyrics.json'), '{"version":1,"segments":[]}');
  return {
    folder,
    analysisPath: path.join(metadata, 'analysis.json'),
    beatsPath: path.join(metadata, 'beats.json'),
    lyricsPath: path.join(metadata, 'lyrics.json'),
  };
};

test('LRC cache hashes only beat features runtime and LRC/audio contents', () => {
  const project = makeProject();
  try {
    const inputs = {audio: 'song.mp3', lyrics: 'lyrics.lrc', runtimeFingerprint: runtime()};
    const first = computeAnalysisHash(project.folder, inputs);
    fs.writeFileSync(path.join(project.folder, 'new-photo.jpg'), 'photo');
    fs.writeFileSync(path.join(project.folder, 'tsuzuri.toml'), 'demucs = true\n');
    assert.equal(computeAnalysisHash(project.folder, inputs), first);
    fs.writeFileSync(path.join(project.folder, 'tsuzuri.toml'), 'demucs = false\nphoto_scale = 0.9\n');
    assert.equal(computeAnalysisHash(project.folder, inputs), first);
    assert.equal(computeAnalysisHash(project.folder, {...inputs, runtimeFingerprint: runtime({backend: 'cpu'})}), first);
    assert.equal(computeAnalysisHash(project.folder, {...inputs, runtimeFingerprint: runtime({model: 'small'})}), first);
    assert.equal(computeAnalysisHash(project.folder, {...inputs, runtimeFingerprint: runtime({demucsAvailable: true})}), first);

    fs.writeFileSync(path.join(project.folder, 'song.mp3'), 'new audio');
    assert.notEqual(computeAnalysisHash(project.folder, inputs), first);
    fs.writeFileSync(path.join(project.folder, 'song.mp3'), 'audio');
    fs.writeFileSync(path.join(project.folder, 'lyrics.lrc'), '[00:02.00]new line');
    assert.notEqual(computeAnalysisHash(project.folder, inputs), first);
  } finally {
    fs.rmSync(project.folder, {recursive: true, force: true});
  }
});

test('no-LRC demucs false ignores availability but tracks backend and model', () => {
  const project = makeProject();
  try {
    fs.writeFileSync(path.join(project.folder, 'tsuzuri.toml'), 'demucs = false\n');
    const inputs = {audio: 'song.mp3', runtimeFingerprint: runtime()};
    const first = computeAnalysisHash(project.folder, inputs);
    assert.equal(computeAnalysisHash(project.folder, {...inputs, runtimeFingerprint: runtime({demucsAvailable: true})}), first);
    assert.notEqual(computeAnalysisHash(project.folder, {...inputs, runtimeFingerprint: runtime({backend: 'cpu'})}), first);
    assert.notEqual(computeAnalysisHash(project.folder, {...inputs, runtimeFingerprint: runtime({model: 'small'})}), first);
  } finally {
    fs.rmSync(project.folder, {recursive: true, force: true});
  }
});

test('no-LRC enabled demucs tracks availability, backend, and model', () => {
  const project = makeProject();
  try {
    const inputs = {audio: 'song.mp3', runtimeFingerprint: runtime()};
    const first = computeAnalysisHash(project.folder, inputs);
    assert.notEqual(computeAnalysisHash(project.folder, {...inputs, runtimeFingerprint: runtime({demucsAvailable: true})}), first);
    assert.notEqual(computeAnalysisHash(project.folder, {...inputs, runtimeFingerprint: runtime({backend: 'cpu'})}), first);
    assert.notEqual(computeAnalysisHash(project.folder, {...inputs, runtimeFingerprint: runtime({model: 'small'})}), first);
    fs.writeFileSync(path.join(project.folder, 'tsuzuri.toml'), 'demucs = true\n');
    assert.equal(computeAnalysisHash(project.folder, inputs), first);
    fs.writeFileSync(path.join(project.folder, 'tsuzuri.toml'), 'demucs = false\n');
    assert.notEqual(computeAnalysisHash(project.folder, inputs), first);
  } finally {
    fs.rmSync(project.folder, {recursive: true, force: true});
  }
});

test('invalid or duplicate demucs config conservatively disables cache hashing', () => {
  const project = makeProject();
  try {
    fs.writeFileSync(path.join(project.folder, 'tsuzuri.toml'), 'demucs = "yes"\n');
    assert.equal(readDemucsSetting(project.folder), null);
    assert.equal(computeAnalysisHash(project.folder, {audio: 'song.mp3', runtimeFingerprint: runtime()}), null);
    fs.writeFileSync(path.join(project.folder, 'tsuzuri.toml'), 'demucs = true\ndemucs = false\n');
    assert.equal(readDemucsSetting(project.folder), null);
  } finally {
    fs.rmSync(project.folder, {recursive: true, force: true});
  }
});

test('manifest requires matching version, hash, and both valid analyzer artifacts', () => {
  const project = makeProject();
  try {
    const audioHash = computeAnalysisHash(project.folder, {audio: 'song.mp3', runtimeFingerprint: runtime()});
    const args = {...project, audioHash};
    assert.equal(hasValidAnalysisCache(args), false);
    writeAnalysisManifest(args);
    assert.equal(hasValidAnalysisCache(args), true);
    assert.deepEqual(JSON.parse(fs.readFileSync(project.analysisPath, 'utf8')), {
      version: ANALYSIS_CACHE_VERSION,
      audio_hash: audioHash,
    });

    fs.writeFileSync(project.lyricsPath, 'broken');
    assert.equal(hasValidAnalysisCache(args), false);
    fs.writeFileSync(project.lyricsPath, '{"version":1}');
    fs.writeFileSync(project.analysisPath, '{"version":1,"audio_hash":"' + audioHash + '"}');
    assert.equal(hasValidAnalysisCache(args), false);
  } finally {
    fs.rmSync(project.folder, {recursive: true, force: true});
  }
});

test('runtime fingerprint accepts only a complete analyzer response', () => {
  const spawn = (_cmd, _args, _opts) => ({
    status: 0,
    stdout: '{"version":1,"beat_features_version":1,"backend":"cpu","model":"small","demucs_available":true}\n',
  });
  assert.equal(
    readAnalysisFingerprint('/analyzer', spawn),
    '{"version":1,"beat_features_version":1,"backend":"cpu","model":"small","demucs_available":true}',
  );
  assert.equal(readAnalysisFingerprint('/analyzer', () => ({status: 1, stdout: ''})), null);
  assert.equal(readAnalysisFingerprint('/analyzer', () => ({status: 0, stdout: '{}'})), null);
  assert.equal(readAnalysisFingerprint('/analyzer', () => ({status: 0, stdout: '{"version":1,"backend":"cpu","model":"small","demucs_available":true}'})), null);
  assert.equal(readAnalysisFingerprint('/analyzer', () => ({status: 0, stdout: '{"version":1,"beat_features_version":1,"backend":"cpu","model":"","demucs_available":true}'})), null);
  // Node keeps the analyzer response complete, then projects it for each path.
  assert.equal(
    readAnalysisFingerprint('/analyzer', () => ({
      status: 0,
      stdout: '{"version":1,"beat_features_version":2,"backend":"cpu","model":"small","demucs_available":true}',
    })),
    '{"version":1,"beat_features_version":2,"backend":"cpu","model":"small","demucs_available":true}',
  );
});

test('runtime field validation also disables direct hash computation', () => {
  const project = makeProject();
  try {
    assert.equal(computeAnalysisHash(project.folder, {audio: 'song.mp3', runtimeFingerprint: '{"version":1}'}), null);
  } finally {
    fs.rmSync(project.folder, {recursive: true, force: true});
  }
});

test('runtime serialization is stable before hashing', () => {
  const project = makeProject();
  try {
    const canonical = runtime({demucsAvailable: true});
    const reordered = '{"model":"medium","demucs_available":true,"backend":"mlx","beat_features_version":1,"version":1}';
    assert.equal(
      computeAnalysisHash(project.folder, {audio: 'song.mp3', runtimeFingerprint: reordered}),
      computeAnalysisHash(project.folder, {audio: 'song.mp3', runtimeFingerprint: canonical}),
    );
  } finally {
    fs.rmSync(project.folder, {recursive: true, force: true});
  }
});
