import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  emptyFilmSettings,
  filmSeedFor,
  filmSettingsPathFor,
  filmSettingsWithOverrides,
  readFilmSettings,
  resolveClipFilms,
  resolvePhotoFilm,
  updateFilmSettings,
  writeFilmSettings,
} from './film-settings.mjs';

const fixture = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kiseki-film-settings-')));

test('film settings live next to the other project metadata', () => {
  assert.equal(filmSettingsPathFor('/album'), path.join('/album', 'output', 'metadata', 'film.json'));
});

test('missing or invalid film settings read as an untouched roll', () => {
  const dir = fixture();
  try {
    const filmPath = filmSettingsPathFor(dir);
    assert.deepEqual(readFilmSettings(filmPath), {version: 1, roll: null, strength: 1, photos: {}});
    fs.mkdirSync(path.dirname(filmPath), {recursive: true});
    fs.writeFileSync(filmPath, '{not json');
    assert.deepEqual(readFilmSettings(filmPath), emptyFilmSettings());
    fs.writeFileSync(filmPath, JSON.stringify([1, 2]));
    assert.deepEqual(readFilmSettings(filmPath), emptyFilmSettings());
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
  }
});

test('reading drops unknown rolls and clamps strengths', () => {
  const dir = fixture();
  try {
    const filmPath = filmSettingsPathFor(dir);
    fs.mkdirSync(path.dirname(filmPath), {recursive: true});
    fs.writeFileSync(filmPath, JSON.stringify({
      version: 1,
      roll: 'no-such-roll',
      strength: 3,
      photos: {
        'a.jpg': {roll: 'velvia', strength: -2},
        'b.jpg': {roll: 'mystery', strength: 0.5},
        'c.jpg': {roll: null},
        'd.jpg': 'velvia',
      },
    }));
    assert.deepEqual(readFilmSettings(filmPath), {
      version: 1,
      roll: null,
      strength: 1,
      photos: {
        'a.jpg': {roll: 'velvia', strength: 0},
        'c.jpg': {roll: null, strength: 1},
      },
    });
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
  }
});

test('writing stores the normalized settings atomically', () => {
  const dir = fixture();
  try {
    const filmPath = filmSettingsPathFor(dir);
    const written = writeFilmSettings(filmPath, {roll: 'classic-chrome', strength: 0.4, photos: {'a.jpg': {roll: 'bogus', strength: 1}}});
    assert.deepEqual(written, {version: 1, roll: 'classic-chrome', strength: 0.4, photos: {}});
    assert.deepEqual(JSON.parse(fs.readFileSync(filmPath, 'utf8')), written);
    assert.deepEqual(fs.readdirSync(path.dirname(filmPath)), ['film.json']);
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
  }
});

test('a photo override wins over the whole roll and null keeps a photo original', () => {
  const settings = {
    version: 1,
    roll: 'classic-chrome',
    strength: 0.8,
    photos: {'b.jpg': {roll: 'velvia', strength: 0.3}, 'c.jpg': {roll: null, strength: 1}},
  };
  assert.deepEqual(resolvePhotoFilm(settings, 'a.jpg'), {roll: 'classic-chrome', strength: 0.8});
  assert.deepEqual(resolvePhotoFilm(settings, 'b.jpg'), {roll: 'velvia', strength: 0.3});
  assert.equal(resolvePhotoFilm(settings, 'c.jpg'), null);
  assert.equal(resolvePhotoFilm({...settings, roll: null}, 'a.jpg'), null);
  assert.deepEqual(resolvePhotoFilm({...settings, roll: null}, 'b.jpg'), {roll: 'velvia', strength: 0.3});
});

test('updating patches the roll, strength and per-photo overrides without mutating input', () => {
  const base = emptyFilmSettings();
  const rolled = updateFilmSettings(base, {roll: 'classic-chrome', strength: 0.6});
  assert.deepEqual(base, emptyFilmSettings());
  assert.deepEqual(rolled, {version: 1, roll: 'classic-chrome', strength: 0.6, photos: {}});
  const overridden = updateFilmSettings(rolled, {photo: {path: 'a.jpg', roll: 'velvia'}});
  assert.deepEqual(overridden.photos, {'a.jpg': {roll: 'velvia', strength: 0.6}});
  const tuned = updateFilmSettings(overridden, {photo: {path: 'a.jpg', strength: 0.2}});
  assert.deepEqual(tuned.photos, {'a.jpg': {roll: 'velvia', strength: 0.2}});
  const original = updateFilmSettings(tuned, {photo: {path: 'b.jpg', roll: null}});
  assert.deepEqual(original.photos['b.jpg'], {roll: null, strength: 0.6});
  const inherited = updateFilmSettings(original, {photo: {path: 'a.jpg', inherit: true}});
  assert.deepEqual(Object.keys(inherited.photos), ['b.jpg']);
  assert.equal(updateFilmSettings(inherited, {roll: null}).roll, null);
});

test('updating rejects unknown rolls and bad strengths', () => {
  const base = emptyFilmSettings();
  assert.throws(() => updateFilmSettings(base, {roll: 'nope'}), TypeError);
  assert.throws(() => updateFilmSettings(base, {strength: 1.5}), TypeError);
  assert.throws(() => updateFilmSettings(base, {strength: '0.5'}), TypeError);
  assert.throws(() => updateFilmSettings(base, {photo: {path: 'a.jpg', roll: 'nope'}}), TypeError);
  assert.throws(() => updateFilmSettings(base, {photo: {path: 'a.jpg', strength: Number.NaN, roll: 'velvia'}}), TypeError);
  assert.throws(() => updateFilmSettings(base, {photo: {path: '', roll: 'velvia'}}), TypeError);
  assert.throws(() => updateFilmSettings(base, {photo: {path: 'a.jpg'}}), TypeError);
  assert.throws(() => updateFilmSettings(base, {photo: {path: 'a.jpg', inherit: true, roll: 'velvia'}}), TypeError);
  assert.throws(() => updateFilmSettings(base, {photo: {path: 'a.jpg', strength: 0.5}}), TypeError);
  assert.throws(() => updateFilmSettings(base, null), TypeError);
});

test('film seeds are stable positive 31-bit integers per photo key', () => {
  const seed = filmSeedFor('day1/a.jpg');
  assert.equal(seed, filmSeedFor('day1/a.jpg'));
  assert.notEqual(seed, filmSeedFor('day1/b.jpg'));
  assert.ok(Number.isInteger(seed) && seed > 0 && seed <= 0x7fffffff);
});

test('command-line film overrides replace only the whole-roll defaults', () => {
  const settings = {version: 1, roll: 'velvia', strength: 0.5, photos: {'a.jpg': {roll: 'acros', strength: 1}}};
  assert.deepEqual(filmSettingsWithOverrides(settings, {}), settings);
  assert.deepEqual(filmSettingsWithOverrides(settings, {film: null, filmStrength: 0.2}), {...settings, roll: null, strength: 0.2});
});

test('clip films read each film source once in batches of eight', async () => {
  let active = 0;
  let maximum = 0;
  const calls = [];
  const clips = [
    ...Array.from({length: 17}, (_, index) => ({src: `${index}.jpg`})),
    {src: '0.jpg'},
    {kind: 'chapter', text: 'Day 2'},
  ];
  const films = await resolveClipFilms(clips, {
    settings: {version: 1, roll: 'classic-chrome', strength: 1, photos: {'3.jpg': {roll: null, strength: 1}}},
    photoKey: (src) => src,
    resolvePhotoPath: (src) => `/album/${src}`,
    extractFilmSource: async (absPath) => {
      calls.push(absPath);
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active -= 1;
      return {sourceLook: null, date: '2026-10-02'};
    },
  });
  assert.equal(maximum, 8);
  assert.equal(calls.length, 16);
  assert.equal(films.has('3.jpg'), false);
  assert.deepEqual(films.get('0.jpg'), {roll: 'classic-chrome', strength: 1, sourceLook: null, date: '2026-10-02', seed: filmSeedFor('0.jpg')});
});
