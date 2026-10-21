import assert from 'node:assert/strict';
import test from 'node:test';

import {
  formatAperture,
  formatCamera,
  formatDatetime,
  formatExposure,
  formatFocal,
  formatIso,
  formatParams,
  isDisplayableExif,
  formatFilmDate,
  readFilmSource,
  shotTimeKeyFromExif,
} from './exif.mjs';

test('formatCamera dedupes Make prefix in Model', () => {
  assert.equal(formatCamera('Sony', 'Sony α7 IV'), 'Sony α7 IV');
  assert.equal(formatCamera('Canon', 'EOS R5'), 'Canon EOS R5');
  assert.equal(formatCamera('Sony', null), 'Sony');
  assert.equal(formatCamera(null, 'α7 IV'), 'α7 IV');
  assert.equal(formatCamera(null, null), undefined);
});

test('formatExposure prefers fraction for sub-second shutter', () => {
  assert.equal(formatExposure(1 / 250), '1/250s');
  assert.equal(formatExposure(1 / 60), '1/60s');
  assert.equal(formatExposure(2), '2s');
  assert.equal(formatExposure(0.5), '1/2s');
  assert.equal(formatExposure(null), null);
});

test('formatFocal / aperture / iso', () => {
  assert.equal(formatFocal(35.2), '35mm');
  assert.equal(formatAperture(1.8), 'f/1.8');
  assert.equal(formatAperture(2), 'f/2');
  assert.equal(formatIso(100), 'ISO 100');
});

test('formatParams returns one display line per present field', () => {
  assert.deepEqual(
    formatParams({focalLength: 35, fNumber: 1.8, exposureTime: 1 / 250, iso: 100}),
    ['35mm', 'f/1.8', '1/250s', 'ISO 100'],
  );
  assert.deepEqual(formatParams({focalLength: 50, fNumber: null, exposureTime: null, iso: 200}), ['50mm', 'ISO 200']);
  assert.equal(formatParams({}), undefined);
});

test('formatDatetime normalizes EXIF string and Date', () => {
  assert.equal(formatDatetime('2026:05:21 18:42:33'), '2026.05.21 18:42');
  assert.equal(formatDatetime('2026-05-21T18:42:00'), '2026.05.21 18:42');
  const d = new Date(2026, 4, 21, 18, 42, 0);
  assert.equal(formatDatetime(d), '2026.05.21 18:42');
  assert.equal(formatDatetime(null), undefined);
});

test('datetime alone is not enough for an EXIF caption', () => {
  assert.equal(isDisplayableExif({datetime: '2026.05.21 18:42'}), false);
  assert.equal(isDisplayableExif({camera: 'FUJIFILM X-T1'}), true);
  assert.equal(isDisplayableExif({params: ['35mm']}), true);
});

test('shot time keys use DateTimeOriginal including seconds, not CreateDate', () => {
  assert.equal(shotTimeKeyFromExif('2026:05:21 18:42:33', '123'), '20260521184233123');
  assert.equal(shotTimeKeyFromExif('2026.05.21 18:42', null), '20260521184200000');
  assert.equal(shotTimeKeyFromExif(null, '123'), null);
});

const fujiMakerNote = (tags) => {
  const bytes = new Uint8Array(14 + tags.length * 12);
  bytes.set([...'FUJIFILM'].map((char) => char.charCodeAt(0)), 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 12, true);
  view.setUint16(12, tags.length, true);
  tags.forEach(([tag, value], index) => {
    const offset = 14 + index * 12;
    view.setUint16(offset, tag, true);
    view.setUint16(offset + 2, 3, true);
    view.setUint32(offset + 4, 1, true);
    view.setUint16(offset + 8, value, true);
  });
  return bytes;
};

test('film source reads the Fujifilm film simulation from the lower-case makerNote bytes', async () => {
  const calls = [];
  const parse = async (file, options) => {
    calls.push({file, options});
    return {makerNote: fujiMakerNote([[0x1401, 0x600]]), DateTimeOriginal: new Date(2026, 9, 2, 13, 27, 57)};
  };
  assert.deepEqual(await readFilmSource('/album/DSCF0001.JPG', {parse}), {
    sourceLook: {maker: 'fujifilm', label: '经典铬', roll: 'classic-chrome'},
    date: '2026-10-02',
  });
  assert.equal(calls[0].file, '/album/DSCF0001.JPG');
  assert.equal(calls[0].options.makerNote, true);
  assert.equal(calls[0].options.gps, false);
});

test('film source never throws and leaves unknown fields empty', async () => {
  assert.deepEqual(await readFilmSource('/x.jpg', {parse: async () => { throw new Error('broken'); }}), {sourceLook: null, date: null});
  assert.deepEqual(await readFilmSource('/x.jpg', {parse: async () => undefined}), {sourceLook: null, date: null});
  assert.deepEqual(await readFilmSource('/x.jpg', {parse: async () => ({makerNote: 'nope', CreateDate: '2025:01:09 10:00:00'})}), {sourceLook: null, date: '2025-01-09'});
  assert.deepEqual(await readFilmSource('/x.jpg', {parse: async () => ({makerNote: new Uint8Array([1, 2, 3])})}), {sourceLook: null, date: null});
  assert.deepEqual(await readFilmSource('/definitely/missing/photo.jpg'), {sourceLook: null, date: null});
});

test('film dates are calendar days in the camera local time', () => {
  assert.equal(formatFilmDate(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
  assert.equal(formatFilmDate(new Date(Number.NaN)), null);
  assert.equal(formatFilmDate('2026:05:21 18:42:33'), '2026-05-21');
  assert.equal(formatFilmDate('yesterday'), null);
  assert.equal(formatFilmDate(null), null);
});
