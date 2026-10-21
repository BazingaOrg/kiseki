import crypto from 'node:crypto';
import path from 'node:path';

import {isRollId} from '../film/src/index.mjs';
import {readJsonFile, writeJsonAtomic} from './atomic-json.mjs';
import {readFilmSource} from './exif.mjs';

export const FILM_SETTINGS_VERSION = 1;
export const DEFAULT_FILM_STRENGTH = 1;

export const filmSettingsPathFor = (projectRoot) =>
  path.join(projectRoot, 'output', 'metadata', 'film.json');

export const emptyFilmSettings = () => ({
  version: FILM_SETTINGS_VERSION,
  roll: null,
  strength: DEFAULT_FILM_STRENGTH,
  photos: {},
});

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

const clampStrength = (value, fallback = DEFAULT_FILM_STRENGTH) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(1, Math.max(0, value));
};

const tolerantRoll = (value) => (isRollId(value) ? value : null);

const isPhotoKey = (key) => typeof key === 'string' && key.length > 0 && !key.includes('\0');

export const normalizeFilmSettings = (value) => {
  if (!isPlainObject(value)) return emptyFilmSettings();
  const strength = clampStrength(value.strength);
  const photos = {};
  if (isPlainObject(value.photos)) {
    for (const [key, entry] of Object.entries(value.photos)) {
      if (!isPhotoKey(key) || !isPlainObject(entry)) continue;
      if (entry.roll !== null && !isRollId(entry.roll)) continue;
      photos[key] = {roll: entry.roll, strength: clampStrength(entry.strength, strength)};
    }
  }
  return {version: FILM_SETTINGS_VERSION, roll: tolerantRoll(value.roll), strength, photos};
};

export const readFilmSettings = (filePath) => normalizeFilmSettings(readJsonFile(filePath));

export const writeFilmSettings = (filePath, settings) => {
  const normalized = normalizeFilmSettings(settings);
  writeJsonAtomic(filePath, normalized);
  return normalized;
};

export const resolvePhotoFilm = (settings, relativePath) => {
  const normalized = normalizeFilmSettings(settings);
  const entry = Object.hasOwn(normalized.photos, relativePath) ? normalized.photos[relativePath] : null;
  if (entry) return entry.roll === null ? null : {roll: entry.roll, strength: entry.strength};
  if (normalized.roll === null) return null;
  return {roll: normalized.roll, strength: normalized.strength};
};

const assertRoll = (value, field) => {
  if (value !== null && !isRollId(value)) throw new TypeError(`${field} 不是已知胶卷`);
  return value;
};

const assertStrength = (value, field) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new TypeError(`${field} 必须是 0–1 之间的数字`);
  }
  return value;
};

export const updateFilmSettings = (settings, patch) => {
  if (!isPlainObject(patch)) throw new TypeError('胶卷设置格式不对');
  const current = normalizeFilmSettings(settings);
  const next = {...current, photos: {...current.photos}};
  if (patch.roll !== undefined) next.roll = assertRoll(patch.roll, 'roll');
  if (patch.strength !== undefined) next.strength = assertStrength(patch.strength, 'strength');
  if (patch.photo !== undefined) {
    const photo = patch.photo;
    if (!isPlainObject(photo) || !isPhotoKey(photo.path)) throw new TypeError('photo.path 必须是照片路径');
    if (photo.inherit !== undefined && photo.inherit !== true) throw new TypeError('photo.inherit 只能是 true');
    if (photo.inherit === true) {
      if (photo.roll !== undefined || photo.strength !== undefined) throw new TypeError('photo.inherit 不能和 roll、strength 同时使用');
      delete next.photos[photo.path];
    } else {
      if (photo.roll === undefined && photo.strength === undefined) throw new TypeError('photo 需要 roll、strength 或 inherit');
      const existing = Object.hasOwn(next.photos, photo.path) ? next.photos[photo.path] : null;
      if (photo.roll === undefined && !existing && next.roll === null) throw new TypeError('photo.strength 需要先选胶卷');
      const roll = photo.roll !== undefined
        ? assertRoll(photo.roll, 'photo.roll')
        : existing ? existing.roll : next.roll;
      const strength = photo.strength !== undefined
        ? assertStrength(photo.strength, 'photo.strength')
        : existing ? existing.strength : next.strength;
      next.photos[photo.path] = {roll, strength};
    }
  }
  return next;
};

export const filmSeedFor = (key) => {
  const value = crypto.createHash('sha256').update(String(key)).digest().readUInt32BE(0) & 0x7fffffff;
  return value === 0 ? 1 : value;
};

export const isFilmPhotoClip = (clip) => (clip.kind === undefined || clip.kind === 'photo') && typeof clip.src === 'string';

export const filmSettingsWithOverrides = (settings, {film, filmStrength} = {}) => ({
  ...settings,
  ...(film !== undefined ? {roll: film} : {}),
  ...(filmStrength !== undefined ? {strength: filmStrength} : {}),
});

export const resolveClipFilms = async (clips, {settings, photoKey, resolvePhotoPath, extractFilmSource = readFilmSource}) => {
  const filmBySrc = new Map();
  for (const clip of clips) {
    if (!isFilmPhotoClip(clip) || filmBySrc.has(clip.src)) continue;
    const key = photoKey(clip.src);
    const film = key ? resolvePhotoFilm(settings, key) : null;
    if (film) filmBySrc.set(clip.src, {...film, seed: filmSeedFor(key)});
  }
  const sources = [...filmBySrc.keys()];
  const sourceBySrc = new Map();
  for (let offset = 0; offset < sources.length; offset += 8) {
    const batch = sources.slice(offset, offset + 8);
    const entries = await Promise.all(batch.map(async (src) => [src, await extractFilmSource(resolvePhotoPath(src))]));
    for (const [src, source] of entries) sourceBySrc.set(src, source);
  }
  return new Map([...filmBySrc].map(([src, film]) => {
    const source = sourceBySrc.get(src);
    return [src, {
      roll: film.roll,
      strength: film.strength,
      sourceLook: source?.sourceLook ?? null,
      date: source?.date ?? null,
      seed: film.seed,
    }];
  }));
};
