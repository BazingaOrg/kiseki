import {ROLLS} from '../../film/src/index.mjs';
import type {Roll} from '../../film/src/index.mjs';
import type {FilmChoice, FilmPatch, FilmSettings} from './types';

export const ALL_TAG = '全部';

export const EMPTY_FILM: FilmSettings = {version: 1, roll: null, strength: 1, photos: {}};

export const photoKey = (assetId: string) => assetId.replace(/^photo:/, '');

export const effectiveChoice = (settings: FilmSettings, assetId: string): FilmChoice & {overridden: boolean} => {
  const override = settings.photos[photoKey(assetId)];
  return override
    ? {...override, overridden: true}
    : {roll: settings.roll, strength: settings.strength, overridden: false};
};

export const applyFilmPatch = (settings: FilmSettings, patch: FilmPatch): FilmSettings => {
  const next: FilmSettings = {...settings, photos: {...settings.photos}};
  if (patch.roll !== undefined) next.roll = patch.roll;
  if (patch.strength !== undefined) next.strength = patch.strength;
  if (patch.photo) {
    const key = photoKey(patch.photo.assetId);
    if (patch.photo.inherit) {
      delete next.photos[key];
    } else {
      const base = effectiveChoice(settings, patch.photo.assetId);
      next.photos[key] = {
        roll: patch.photo.roll !== undefined ? patch.photo.roll : base.roll,
        strength: patch.photo.strength ?? base.strength,
      };
    }
  }
  return next;
};

export const inverseFilmPatch = (before: FilmSettings, patch: FilmPatch): FilmPatch => {
  if (patch.photo) {
    const previous = before.photos[photoKey(patch.photo.assetId)];
    return {photo: previous ? {assetId: patch.photo.assetId, ...previous} : {assetId: patch.photo.assetId, inherit: true}};
  }
  return {roll: before.roll, strength: before.strength};
};

export const rollsForTag = (tag: string): readonly Roll[] =>
  tag === ALL_TAG ? ROLLS : ROLLS.filter((roll) => roll.tags.includes(tag));

export const overrideCount = (settings: FilmSettings, photoIds: string[]) =>
  photoIds.filter((id) => settings.photos[photoKey(id)] !== undefined).length;

export type FilmSaveResult = {ok: true; data: FilmSettings} | {ok: false; message: string};

export const createFilmSaveQueue = (
  initial: FilmSettings,
  save: (patch: FilmPatch) => Promise<FilmSaveResult>,
  onChange: (settings: FilmSettings, pending: boolean, error: string | null) => void,
) => {
  let confirmed = initial;
  const pending: FilmPatch[] = [];
  let running: Promise<void> | null = null;
  let error: string | null = null;
  const current = () => pending.reduce(applyFilmPatch, confirmed);
  const publish = () => onChange(current(), pending.length > 0, error);
  const drain = async () => {
    while (pending.length > 0) {
      const patch = pending[0];
      try {
        const result = await save(patch);
        if (result.ok) confirmed = result.data;
        else error = result.message;
      } catch {
        error = '连不上 kiseki 服务，确认它还在跑。';
      }
      pending.shift();
      publish();
    }
    running = null;
  };
  return {
    current,
    enqueue: (patch: FilmPatch) => {
      if (!running) error = null;
      const photo = patch.photo;
      const complete = photo && !photo.inherit
        ? {photo: {roll: effectiveChoice(current(), photo.assetId).roll, strength: effectiveChoice(current(), photo.assetId).strength, ...photo}}
        : patch;
      pending.push(complete);
      publish();
      running ??= Promise.resolve().then(drain);
    },
    flush: async () => {
      while (running) await running;
      return error === null;
    },
  };
};

export type FilmViewMode = 'original-left' | 'effect-left' | 'effect';

export const nextFilmViewMode = (mode: FilmViewMode): FilmViewMode =>
  mode === 'original-left' ? 'effect-left' : mode === 'effect-left' ? 'effect' : 'original-left';

export const swapFilmViewMode = (mode: FilmViewMode): FilmViewMode =>
  mode === 'original-left' ? 'effect-left' : mode === 'effect-left' ? 'original-left' : 'effect';

export const filmViewAction = (mode: FilmViewMode) =>
  mode === 'original-left' ? '交换左右' : mode === 'effect-left' ? '看完整效果' : '开启对比';

export const filmViewLabel = (mode: FilmViewMode) =>
  mode === 'original-left' ? '左原图、右胶片' : mode === 'effect-left' ? '左胶片、右原图' : '完整胶片效果';
