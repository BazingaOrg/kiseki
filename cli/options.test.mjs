import assert from 'node:assert/strict';
import test from 'node:test';

import {CliError, parseArgs} from './options.mjs';

test('bare folder argument routes to the render command', () => {
  assert.deepEqual(parseArgs(['album']), {
    command: 'render', folder: 'album', output: null, exif: false, sign: false, dark: false, portrait: false, square: false, draft: false, trim: null, filter: null, template: null,
  });
  assert.deepEqual(parseArgs(['album', '-o', 'out.mp4']), {
    command: 'render',
    folder: 'album',
    output: 'out.mp4',
    exif: false,
    sign: false,
    dark: false,
    portrait: false,
    square: false,
    draft: false,
    trim: null,
    filter: null,
    template: null,
  });
});

test('render command accepts --exif, --sign, and --dark flags', () => {
  assert.deepEqual(parseArgs(['album', '--exif', '--sign', '--dark']), {
    command: 'render',
    folder: 'album',
    output: null,
    exif: true,
    sign: true,
    dark: true,
    portrait: false,
    square: false,
    draft: false,
    trim: null,
    filter: null,
    template: null,
  });
  assert.deepEqual(parseArgs(['album', '-o', 'out.mp4', '--exif']), {
    command: 'render',
    folder: 'album',
    output: 'out.mp4',
    exif: true,
    sign: false,
    dark: false,
    portrait: false,
    square: false,
    draft: false,
    trim: null,
    filter: null,
    template: null,
  });
});

test('render command rejects an unknown flag before or after the folder', () => {
  assert.throws(() => parseArgs(['--exfi']), /未知参数: --exfi/);
  assert.throws(() => parseArgs(['--exfi', 'album']), /未知参数: --exfi/);
  assert.throws(() => parseArgs(['album', '--exfi']), /未知参数: --exfi/);
});

test('render command accepts --draft before or after the folder', () => {
  assert.equal(parseArgs(['album', '--draft']).draft, true);
  assert.equal(parseArgs(['--draft', 'album']).draft, true);
});

test('render and still accept one portrait or square preset, but not both', () => {
  assert.equal(parseArgs(['album', '--portrait']).portrait, true);
  assert.equal(parseArgs(['album', '--square']).square, true);
  assert.equal(parseArgs(['still', 'photo.jpg', '--portrait']).portrait, true);
  for (const args of [['album', '--portrait', '--square'], ['still', 'photo.jpg', '--portrait', '--square']]) {
    assert.throws(() => parseArgs(args), /不能同时使用/);
  }
});

test('render command accepts one-time trim overrides', () => {
  assert.equal(parseArgs(['album', '--trim', 'full']).trim, 'full');
  assert.equal(parseArgs(['--trim', 'auto', 'album']).trim, 'auto');
  assert.equal(parseArgs(['album', '--trim', '12.5']).trim, '12.5');
});

test('render command rejects invalid trim overrides', () => {
  for (const value of ['never', '0', '-2', 'Infinity', '0x10']) {
    assert.throws(() => parseArgs(['album', '--trim', value]), /--trim/);
  }
  assert.throws(() => parseArgs(['album', '--trim']), /--trim/);
});

test('a leading `doctor` token routes to the doctor command', () => {
  assert.deepEqual(parseArgs(['doctor']), {command: 'doctor'});
});

test('extra arguments after doctor are a usage error', () => {
  assert.throws(() => parseArgs(['doctor', 'extra']), CliError);
  assert.throws(() => parseArgs(['doctor', 'extra']), /doctor 不接受额外参数/);
});

test('a leading `lyrics` token routes to the lyrics command', () => {
  assert.deepEqual(parseArgs(['lyrics', 'album']), {command: 'lyrics', folder: 'album', replace: false});
  assert.deepEqual(parseArgs(['lyrics', 'album', '--replace']), {command: 'lyrics', folder: 'album', replace: true});
});

test('lyrics without a folder is a usage error', () => {
  assert.throws(() => parseArgs(['lyrics']), CliError);
  assert.throws(() => parseArgs(['lyrics']), /用法: tsuzuri lyrics <folder>/);
});

test('lyrics does not accept -o', () => {
  assert.throws(() => parseArgs(['lyrics', 'album', '-o', 'out.mp4']), CliError);
  assert.throws(() => parseArgs(['lyrics', 'album', '-o', 'out.mp4']), /不支持 -o/);
});

test('a leading `fetch` token routes to the fetch command', () => {
  assert.deepEqual(parseArgs(['fetch', 'album']), {command: 'fetch', folder: 'album'});
});

test('fetch without a folder or with extra arguments is a usage error', () => {
  assert.throws(() => parseArgs(['fetch']), /用法: tsuzuri fetch <folder>/);
  assert.throws(() => parseArgs(['fetch', 'a', 'b']), /未知参数: b/);
  assert.throws(() => parseArgs(['fetch', 'album', '--audio']), /未知参数: --audio/);
});

test('a leading `help` token (or -h / --help) routes to the help command', () => {
  assert.deepEqual(parseArgs(['help']), {command: 'help'});
  assert.deepEqual(parseArgs(['-h']), {command: 'help'});
  assert.deepEqual(parseArgs(['--help']), {command: 'help'});
});

test('a path-qualified folder named doctor/lyrics/still/fetch/help is the escape hatch, not a verb', () => {
  const flags = {exif: false, sign: false, dark: false, portrait: false, square: false, draft: false, trim: null, filter: null, template: null};
  assert.deepEqual(parseArgs(['./lyrics']), {command: 'render', folder: './lyrics', output: null, ...flags});
  assert.deepEqual(parseArgs(['./fetch']), {command: 'render', folder: './fetch', output: null, ...flags});
  assert.deepEqual(parseArgs(['./doctor']), {command: 'render', folder: './doctor', output: null, ...flags});
  assert.deepEqual(parseArgs(['./help']), {command: 'render', folder: './help', output: null, ...flags});
  assert.deepEqual(parseArgs(['./still']), {command: 'render', folder: './still', output: null, ...flags});
  assert.deepEqual(parseArgs(['/abs/path/lyrics']), {
    command: 'render',
    folder: '/abs/path/lyrics',
    output: null,
    ...flags,
  });
});

test('a leading `still` token routes to the still command with defaults', () => {
  assert.deepEqual(parseArgs(['still', 'photo.jpg']), {
    command: 'still',
    target: 'photo.jpg',
    output: null,
    exif: false,
    sign: false,
    dark: false,
    portrait: false,
    square: false,
    skipExisting: false,
    scale: 2,
    filter: null,
  });
});

test('still accepts -o, --exif, and --scale', () => {
  assert.deepEqual(parseArgs(['still', './photos', '-o', 'out', '--exif', '--scale', '3']), {
    command: 'still',
    target: './photos',
    output: 'out',
    exif: true,
    sign: false,
    dark: false,
    portrait: false,
    square: false,
    skipExisting: false,
    scale: 3,
    filter: null,
  });
});

test('still accepts signature and explicit resume flags', () => {
  const parsed = parseArgs(['still', './photos', '--sign', '--skip-existing']);
  assert.equal(parsed.sign, true);
  assert.equal(parsed.skipExisting, true);
});

test('still accepts --dark alongside the other variant flags', () => {
  const parsed = parseArgs(['still', './photos', '--exif', '--sign', '--dark']);
  assert.equal(parsed.exif, true);
  assert.equal(parsed.sign, true);
  assert.equal(parsed.dark, true);
});

test('still rejects unknown flags when --dark is present', () => {
  assert.throws(
    () => parseArgs(['still', './photos', '--dark', '--sepia']),
    /未知参数: --sepia/,
  );
});

test('still --scale must be integer 1–4', () => {
  assert.throws(() => parseArgs(['still', 'a.jpg', '--scale', '5']), CliError);
  assert.throws(() => parseArgs(['still', 'a.jpg', '--scale', '1.5']), CliError);
  assert.throws(() => parseArgs(['still', 'a.jpg', '--scale']), CliError);
});

test('still without a target is a usage error', () => {
  assert.throws(() => parseArgs(['still']), /tsuzuri still/);
  assert.throws(() => parseArgs(['still']), /--dark/);
  assert.throws(() => parseArgs(['still']), /--skip-existing/);
});

test('render command accepts --filter with optional --filter-intensity', () => {
  assert.deepEqual(parseArgs(['album', '--filter', 'mono']).filter, {id: 'mono'});
  assert.deepEqual(parseArgs(['album', '--filter', 'mono', '--filter-intensity', '0.5']).filter, {
    id: 'mono',
    intensity: 0.5,
  });
  assert.deepEqual(parseArgs(['album', '--filter-intensity', '0.5', '--filter', 'warm']).filter, {
    id: 'warm',
    intensity: 0.5,
  });
});

test('filter aliases are normalized to the registry id before render args are built', () => {
  assert.deepEqual(parseArgs(['album', '--filter', 'teal_orange']).filter, {id: 'teal-orange'});
});

test('render command accepts --template with a known id', () => {
  assert.equal(parseArgs(['album', '--template', 'slow-cinema']).template, 'slow-cinema');
  assert.equal(parseArgs(['album', '--template', 'polaroid']).template, 'polaroid');
});

test('render command rejects unknown or missing template id and lists available ids', () => {
  assert.throws(() => parseArgs(['album', '--template', 'nope']), /未知模板 id: nope/);
  assert.throws(() => parseArgs(['album', '--template', 'nope']), /slow-cinema/);
  assert.throws(() => parseArgs(['album', '--template']), /需要模板 id/);
});

test('render command rejects unknown filter id and lists available ids', () => {
  assert.throws(() => parseArgs(['album', '--filter', 'nope']), /未知滤镜 id: nope/);
  assert.throws(() => parseArgs(['album', '--filter', 'nope']), /faded/);
});

test('render command rejects --filter-intensity outside 0-1 or without --filter', () => {
  assert.throws(() => parseArgs(['album', '--filter', 'mono', '--filter-intensity', '1.5']), /--filter-intensity/);
  assert.throws(() => parseArgs(['album', '--filter', 'mono', '--filter-intensity', '-0.1']), /--filter-intensity/);
  assert.throws(() => parseArgs(['album', '--filter-intensity', '0.5']), /--filter-intensity 需要搭配 --filter/);
});

test('still accepts --filter with optional --filter-intensity', () => {
  assert.deepEqual(parseArgs(['still', 'a.jpg', '--filter', 'vintage']).filter, {id: 'vintage'});
  assert.deepEqual(parseArgs(['still', 'a.jpg', '--filter', 'vintage', '--filter-intensity', '0.8']).filter, {
    id: 'vintage',
    intensity: 0.8,
  });
});

test('still rejects unknown filter id and lists available ids', () => {
  assert.throws(() => parseArgs(['still', 'a.jpg', '--filter', 'nope']), /未知滤镜 id: nope/);
  assert.throws(() => parseArgs(['still', 'a.jpg', '--filter', 'nope']), /faded/);
});

test('missing folder in the default command reports usage listing all forms', () => {
  assert.throws(() => parseArgs([]), /tsuzuri <folder> \[-o out\.mp4\]/);
  assert.throws(() => parseArgs([]), /tsuzuri doctor/);
  assert.throws(() => parseArgs([]), /tsuzuri lyrics <folder>/);
  assert.throws(() => parseArgs([]), /tsuzuri still/);
});

test('web command accepts an optional folder argument', () => {
  assert.deepEqual(parseArgs(['web']), {command: 'web', folder: null});
  assert.deepEqual(parseArgs(['web', 'album']), {command: 'web', folder: 'album'});
});

test('web command rejects extra flag-like arguments', () => {
  assert.throws(() => parseArgs(['web', 'album', '--bogus']), /未知参数: --bogus/);
});
