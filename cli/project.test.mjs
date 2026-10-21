import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  copyLegacyJson, copyLegacyMetadata, ensureProjectDirs, hasExplicitTrimConfig,
  readTrimPreference, resolveProjectPaths, scanFolder, scanFolderLoose, writeTrimPreference,
} from './project.mjs';

const makeFolder = (files) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kiseki-scan-'));
  for (const name of files) fs.writeFileSync(path.join(dir, name), '');
  return dir;
};

test('scanFolder lists unsupported video files for the caller to warn about', () => {
  const dir = makeFolder(['a.jpg', 'b.png', 'music.mp3', 'clip.mp4', 'IMG_0001.MOV']);
  const result = scanFolder(dir);
  assert.deepEqual(result.videos, ['IMG_0001.MOV', 'clip.mp4']);
  assert.deepEqual(result.photos, ['a.jpg', 'b.png']);
  assert.equal(result.audio, 'music.mp3');
});

test('scanFolder returns an empty videos list when none are present', () => {
  const dir = makeFolder(['a.jpg', 'music.mp3']);
  assert.deepEqual(scanFolder(dir).videos, []);
});

test('scanFolder can return photos without audio when audio is optional', () => {
  const dir = makeFolder(['a.jpg', 'b.png']);
  try {
    assert.deepEqual(scanFolder(dir, {requireAudio: false}), {
      photos: ['a.jpg', 'b.png'],
      audio: null,
      lyrics: null,
      videos: [],
    });
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
  }
});

test('missing audio error points to the fetch recovery command', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kiseki-scan-'));
  const dir = path.join(root, 'my trip');
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'a.jpg'), '');
  try {
    assert.throws(
      () => scanFolder(dir),
      (error) => error.message.includes(`node cli/kiseki.mjs fetch '${dir}'`),
    );
  } finally {
    fs.rmSync(root, {recursive: true, force: true});
  }
});

test('scanFolder discovers audio and lyrics in audio/ as relative paths', () => {
  const dir = makeFolder(['photo.jpg']);
  fs.mkdirSync(path.join(dir, 'audio'));
  fs.writeFileSync(path.join(dir, 'audio', 'song.m4a'), 'audio');
  fs.writeFileSync(path.join(dir, 'audio', 'song.lrc'), 'lyrics');
  try {
    assert.deepEqual(scanFolder(dir), {
      photos: ['photo.jpg'],
      audio: 'audio/song.m4a',
      lyrics: 'audio/song.lrc',
      videos: [],
    });
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
  }
});

test('root and audio/ files are counted together without a silent priority', () => {
  const dir = makeFolder(['root.mp3', 'root.lrc']);
  fs.mkdirSync(path.join(dir, 'audio'));
  fs.writeFileSync(path.join(dir, 'audio', 'nested.m4a'), 'audio');
  fs.writeFileSync(path.join(dir, 'audio', 'nested.lrc'), 'lyrics');
  try {
    assert.deepEqual(scanFolderLoose(dir).audios, ['audio/nested.m4a', 'root.mp3']);
    assert.throws(() => scanFolder(dir), /audio\/nested\.m4a.*root\.mp3/s);
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
  }
});

test('trim preferences accept only version 1 auto or full values', () => {
  const dir = makeFolder([]);
  try {
    assert.equal(hasExplicitTrimConfig(dir), false);
    const preferencesPath = resolveProjectPaths(dir).preferencesPath;
    assert.equal(readTrimPreference(preferencesPath), null);
    writeTrimPreference(preferencesPath, 'auto');
    assert.deepEqual(JSON.parse(fs.readFileSync(preferencesPath, 'utf8')), {version: 1, trim: 'auto'});
    assert.equal(readTrimPreference(preferencesPath), 'auto');
    fs.writeFileSync(preferencesPath, JSON.stringify({version: 2, trim: 'full'}));
    assert.equal(readTrimPreference(preferencesPath), null);
    fs.writeFileSync(preferencesPath, JSON.stringify({version: 1, trim: 'seconds'}));
    assert.equal(readTrimPreference(preferencesPath), null);
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
  }
});

test('legacy metadata is copied only into an empty new directory, then root JSON fills gaps', () => {
  const dir = makeFolder([]);
  try {
    const paths = resolveProjectPaths(dir);
    fs.mkdirSync(path.join(dir, 'metadata'));
    fs.writeFileSync(path.join(dir, 'metadata', 'analysis.json'), 'old analysis');
    fs.mkdirSync(path.join(dir, 'metadata', 'nested'));
    fs.writeFileSync(path.join(dir, 'metadata', 'nested', 'note.txt'), 'old note');
    fs.writeFileSync(path.join(dir, 'beats.json'), 'root beats');
    fs.writeFileSync(path.join(dir, 'timeline.json'), 'root timeline');
    ensureProjectDirs(paths);
    assert.equal(copyLegacyMetadata(dir, paths.metadataDir), true);
    assert.equal(fs.readFileSync(paths.analysisPath, 'utf8'), 'old analysis');
    assert.equal(fs.readFileSync(path.join(paths.metadataDir, 'nested', 'note.txt'), 'utf8'), 'old note');
    assert.deepEqual(copyLegacyJson(dir, paths.metadataDir), ['beats.json', 'timeline.json']);
    assert.equal(copyLegacyMetadata(dir, paths.metadataDir), false);
    fs.writeFileSync(path.join(dir, 'metadata', 'lyrics.json'), 'old lyrics');
    assert.equal(copyLegacyMetadata(dir, paths.metadataDir), false);
    assert.equal(fs.existsSync(paths.lyricsPath), false);
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
  }
});
