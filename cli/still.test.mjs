import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {CliError} from './options.mjs';
import {formatStillDiagnostics, loadStillCanvasConfig, resolveJobs} from './still.mjs';

const fixture = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tsuzuri-still-'));

test('still projects the shared strict config and preserves # inside quoted text', () => {
  const dir = fixture();
  try {
    fs.writeFileSync(
      path.join(dir, 'tsuzuri.toml'),
      'width = 1280\nheight = 720\nbackground = "#123456"\nphoto_scale = 0.5\noutro_text = "a # b"\n',
    );
    assert.deepEqual(loadStillCanvasConfig(dir), {
      width: 1280,
      height: 720,
      background: '#123456',
      photo_scale: 0.5,
      signature: '',
    });
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
  }
});

test('still diagnostics report effective pixels, scale, photo count, and output destination', () => {
  assert.equal(
    formatStillDiagnostics({
      canvas: {width: 1080, height: 1920},
      scale: 2,
      jobs: [
        {outPath: '/tmp/album/output/stills/a.png'},
        {outPath: '/tmp/album/output/stills/b.png'},
      ],
    }),
    '实际静态导出配置:2160×3840 px;输出倍率 2;2 张;输出 /tmp/album/output/stills',
  );
});

test('still fails fast for an invalid shared config instead of falling back to defaults', () => {
  const dir = fixture();
  try {
    fs.writeFileSync(path.join(dir, 'tsuzuri.toml'), 'background = FFFFFF\n');
    assert.throws(() => loadStillCanvasConfig(dir), CliError);
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
  }
});

test('default and EXIF variants use separate output names', () => {
  const dir = fixture();
  const photo = path.join(dir, 'IMG.jpg');
  fs.writeFileSync(photo, 'x');
  assert.equal(path.basename(resolveJobs(photo, null).jobs[0].outPath), 'IMG.png');
  assert.equal(path.basename(resolveJobs(photo, null, {exif: true}).jobs[0].outPath), 'IMG-exif.png');
  assert.equal(path.basename(resolveJobs(photo, null, {sign: true}).jobs[0].outPath), 'IMG-sign.png');
  assert.equal(path.basename(resolveJobs(photo, null, {exif: true, sign: true}).jobs[0].outPath), 'IMG-exif-sign.png');
});

test('still filter suffix is stable and never rewrites an explicit output file', () => {
  const dir = fixture();
  const photo = path.join(dir, 'IMG.jpg');
  fs.writeFileSync(photo, 'x');
  assert.equal(path.basename(resolveJobs(photo, null, {filter: {id: 'mono', intensity: 0.80}}).jobs[0].outPath), 'IMG-mono-0.8.png');
  assert.equal(
    resolveJobs(photo, path.join(dir, 'custom.png'), {filter: {id: 'mono', intensity: 0.8}}).jobs[0].outPath,
    path.join(dir, 'custom.png'),
  );
});

test('still reads an explicit project filter config for the default filename', () => {
  const dir = fixture();
  const photo = path.join(dir, 'IMG.jpg');
  fs.writeFileSync(photo, 'x');
  fs.writeFileSync(path.join(dir, 'tsuzuri.json'), JSON.stringify({filter: 'teal_orange', intensity: 0.80}));
  assert.equal(path.basename(resolveJobs(photo, null).jobs[0].outPath), 'IMG-teal-orange-0.8.png');
});

test('dark variants append a final suffix for every EXIF/sign combination', () => {
  const dir = fixture();
  const photo = path.join(dir, 'IMG.jpg');
  fs.writeFileSync(photo, 'x');
  assert.equal(path.basename(resolveJobs(photo, null, {dark: true}).jobs[0].outPath), 'IMG-dark.png');
  assert.equal(path.basename(resolveJobs(photo, null, {exif: true, dark: true}).jobs[0].outPath), 'IMG-exif-dark.png');
  assert.equal(path.basename(resolveJobs(photo, null, {sign: true, dark: true}).jobs[0].outPath), 'IMG-sign-dark.png');
  assert.equal(path.basename(resolveJobs(photo, null, {exif: true, sign: true, dark: true}).jobs[0].outPath), 'IMG-exif-sign-dark.png');
});

test('portrait and square variants append after presentation suffixes without changing explicit file output', () => {
  const dir = fixture();
  const photo = path.join(dir, 'IMG.jpg');
  fs.writeFileSync(photo, 'x');
  assert.equal(path.basename(resolveJobs(photo, null, {exif: true, portrait: true}).jobs[0].outPath), 'IMG-exif-portrait.png');
  assert.equal(path.basename(resolveJobs(photo, null, {dark: true, square: true}).jobs[0].outPath), 'IMG-dark-square.png');
  assert.equal(path.basename(resolveJobs(photo, null, {exif: true, sign: true, dark: true, portrait: true}).jobs[0].outPath), 'IMG-exif-sign-dark-portrait.png');
  assert.equal(resolveJobs(photo, path.join(dir, 'custom.png'), {portrait: true}).jobs[0].outPath, path.join(dir, 'custom.png'));
  assert.equal(path.basename(resolveJobs(photo, `${path.join(dir, 'cards')}/`, {square: true}).jobs[0].outPath), 'IMG-square.png');
});

test('single-file non-PNG output extension is rejected', () => {
  const dir = fixture();
  const photo = path.join(dir, 'IMG.jpg');
  fs.writeFileSync(photo, 'x');
  assert.throws(() => resolveJobs(photo, path.join(dir, 'out.jpg')), CliError);
});

test('a trailing separator on -o marks directory intent even before the directory exists', () => {
  const dir = fixture();
  const photo = path.join(dir, 'IMG.jpg');
  fs.writeFileSync(photo, 'x');
  // `\` 结尾只在 win32 视为分隔符(POSIX 上是合法文件名字符),此处只验证 `/`
  const job = resolveJobs(photo, `${path.join(dir, 'cards')}/`, {exif: true}).jobs[0];
  assert.equal(path.basename(path.dirname(job.outPath)), 'cards');
  assert.equal(path.basename(job.outPath), 'IMG-exif.png');
});

test('same-stem batch sources retain their source extension', () => {
  const dir = fixture();
  fs.writeFileSync(path.join(dir, 'a.jpg'), 'x');
  fs.writeFileSync(path.join(dir, 'a.webp'), 'x');
  const names = resolveJobs(dir, null).jobs.map((job) => path.basename(job.outPath));
  assert.deepEqual(names, ['a-jpg.png', 'a-webp.png']);
});

test('batch rejects source names that collide across variant runs', () => {
  const dir = fixture();
  fs.writeFileSync(path.join(dir, 'IMG.jpg'), 'x');
  fs.writeFileSync(path.join(dir, 'IMG-dark.jpg'), 'x');
  assert.throws(() => resolveJobs(dir, null), /still 变体输出冲突/);
  assert.throws(() => resolveJobs(dir, null, {dark: true}), /IMG-dark\.png/);
});

test('batch rejects collisions with every portrait and square presentation combination', () => {
  for (const suffix of ['-exif-portrait', '-dark-square', '-exif-sign-dark-portrait']) {
    const dir = fixture();
    fs.writeFileSync(path.join(dir, 'IMG.jpg'), 'x');
    fs.writeFileSync(path.join(dir, `IMG${suffix}.jpg`), 'x');
    assert.throws(() => resolveJobs(dir, null), /still 变体输出冲突/);
  }
});
