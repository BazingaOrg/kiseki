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
