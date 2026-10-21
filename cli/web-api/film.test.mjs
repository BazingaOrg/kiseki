import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {filmSettingsPathFor, readFilmSettings} from '../film-settings.mjs';
import {createTaskLeaseManager} from '../task-lease.mjs';
import {FilmRequestError, saveFilmSettings} from './film.mjs';

const fixture = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kiseki-film-api-')));
const stubLeaseManager = () => ({acquire: () => ({}), release: () => true});
const deps = () => ({isJobRunning: () => false, leaseManager: stubLeaseManager()});
const rejectsWith = (promise, status) => assert.rejects(promise, (error) => error instanceof FilmRequestError && error.status === status);

test('saving the whole roll and a photo override returns and stores normalized settings', async () => {
  const dir = fixture();
  try {
    fs.writeFileSync(path.join(dir, 'a.jpg'), 'image');
    fs.writeFileSync(path.join(dir, 'b.jpg'), 'image');
    const rolled = await saveFilmSettings({...deps(), folder: dir, roll: 'classic-chrome', strength: 0.6});
    assert.deepEqual(rolled, {version: 1, roll: 'classic-chrome', strength: 0.6, photos: {}});
    const overridden = await saveFilmSettings({...deps(), folder: dir, photo: {assetId: 'photo:b.jpg', roll: null}});
    assert.deepEqual(overridden.photos, {'b.jpg': {roll: null, strength: 0.6}});
    assert.deepEqual(readFilmSettings(filmSettingsPathFor(dir)), overridden);
    const inherited = await saveFilmSettings({...deps(), folder: dir, photo: {assetId: 'photo:b.jpg', inherit: true}});
    assert.deepEqual(inherited.photos, {});
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
  }
});

test('invalid film requests are rejected without writing', async () => {
  const dir = fixture();
  try {
    fs.writeFileSync(path.join(dir, 'a.jpg'), 'image');
    fs.writeFileSync(path.join(dir, 'song.mp3'), 'audio');
    await rejectsWith(saveFilmSettings({...deps(), folder: dir, roll: 'kodachrome'}), 400);
    await rejectsWith(saveFilmSettings({...deps(), folder: dir, strength: 2}), 400);
    await rejectsWith(saveFilmSettings({...deps(), folder: dir}), 400);
    await rejectsWith(saveFilmSettings({...deps(), folder: dir, photo: 'a.jpg'}), 400);
    await rejectsWith(saveFilmSettings({...deps(), folder: dir, photo: {assetId: 'audio:song.mp3', roll: 'velvia'}}), 400);
    await rejectsWith(saveFilmSettings({...deps(), folder: dir, photo: {assetId: 'photo:missing.jpg', roll: 'velvia'}}), 404);
    await rejectsWith(saveFilmSettings({...deps(), folder: dir, photo: {assetId: 'photo:../a.jpg', roll: 'velvia'}}), 404);
    assert.equal(fs.existsSync(filmSettingsPathFor(dir)), false);
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
  }
});

test('film settings cannot change while a job runs or the project is busy', async () => {
  const dir = fixture();
  try {
    await rejectsWith(saveFilmSettings({folder: dir, roll: 'velvia', isJobRunning: () => true, leaseManager: stubLeaseManager()}), 409);
    const leaseManager = createTaskLeaseManager({registryRoot: path.join(dir, '.test-runtime', 'leases')});
    const held = leaseManager.acquire({kind: 'render', resources: [dir]});
    try {
      await rejectsWith(saveFilmSettings({folder: dir, roll: 'velvia', isJobRunning: () => false, leaseManager}), 409);
    } finally {
      leaseManager.release(held);
    }
    assert.equal(fs.existsSync(filmSettingsPathFor(dir)), false);
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
  }
});

test('film settings refuse symlinked projects and metadata', async () => {
  const dir = fixture();
  const outside = fixture();
  try {
    const linkedProject = path.join(outside, 'linked');
    fs.symlinkSync(dir, linkedProject);
    await rejectsWith(saveFilmSettings({...deps(), folder: linkedProject, roll: 'velvia'}), 400);
    fs.mkdirSync(path.join(dir, 'output'));
    fs.symlinkSync(outside, path.join(dir, 'output', 'metadata'));
    await rejectsWith(saveFilmSettings({...deps(), folder: dir, roll: 'velvia'}), 409);
    assert.equal(fs.existsSync(path.join(outside, 'film.json')), false);
    await rejectsWith(saveFilmSettings({...deps(), folder: 'relative\0path', roll: 'velvia'}), 403);
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
    fs.rmSync(outside, {recursive: true, force: true});
  }
});

test('an aborted film request does not write', async () => {
  const dir = fixture();
  try {
    const controller = new AbortController();
    controller.abort();
    await rejectsWith(saveFilmSettings({...deps(), folder: dir, roll: 'velvia', signal: controller.signal}), 499);
    assert.equal(fs.existsSync(filmSettingsPathFor(dir)), false);
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
  }
});
