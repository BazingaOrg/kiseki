import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  buildArgvFromChoices,
  MENU_BACK,
  normalizeDroppedPath,
  runMenu,
  writeBanner,
  writeFarewell,
} from './menu.mjs';
import {FILTER_IDS} from './filters.mjs';
import {PICK_BACK} from './prompts.mjs';

const interact = async ({lines, confirms = [], picks = []}) => {
  let text = '';
  const output = {write: (chunk) => { text += chunk; }};
  const confirmCalls = [];
  const promptRunner = (fn) => fn({
    line: async (_prompt, options = {}) => {
      for (;;) {
        const value = lines.shift();
        if (options.emptyBack && !value) return PICK_BACK;
        if (options.allowBack && value === '0') return PICK_BACK;
        const valid = options.validate ? await options.validate(value) : true;
        if (valid === true || valid === undefined) return value;
        text += `${valid}\n`;
      }
    },
    confirm: async (prompt, options = {}) => {
      confirmCalls.push({prompt, options});
      return confirms.shift();
    },
    pick: async (_prompt, _items, _options = {}) => picks.shift() ?? {index: 0},
  });
  const result = await runMenu({output, promptRunner});
  return {result, output: text, confirmCalls};
};

test('normalizeDroppedPath unescapes macOS drag-and-drop sequences', () => {
  assert.equal(normalizeDroppedPath('/Users/me/My\\ Photos'), '/Users/me/My Photos');
  assert.equal(normalizeDroppedPath('/Users/me/Photos\\ \\(2024\\)'), '/Users/me/Photos (2024)');
});

test('normalizeDroppedPath strips paired quotes from Windows drag-and-drop', () => {
  assert.equal(normalizeDroppedPath('"C:\\Users\\me\\My Photos"'), 'C:\\Users\\me\\My Photos');
  assert.equal(normalizeDroppedPath("'./photos'"), './photos');
});

test('normalizeDroppedPath keeps Windows separators and UNC prefixes intact', () => {
  assert.equal(normalizeDroppedPath('C:\\Users\\me\\trip'), 'C:\\Users\\me\\trip');
  assert.equal(normalizeDroppedPath('\\\\server\\share\\trip'), '\\\\server\\share\\trip');
});

test('normalizeDroppedPath expands a leading tilde and trims whitespace', () => {
  assert.equal(normalizeDroppedPath('  ~/photos  '), `${os.homedir()}/photos`);
  assert.equal(normalizeDroppedPath('~'), os.homedir());
});

test('buildArgvFromChoices maps each menu entry onto CLI argv', () => {
  assert.deepEqual(buildArgvFromChoices({choice: '1', target: './trip'}), ['./trip']);
  assert.deepEqual(buildArgvFromChoices({choice: '1', target: './trip', exif: true, sign: true}), [
    './trip',
    '--exif',
    '--sign',
  ]);
  assert.deepEqual(buildArgvFromChoices({choice: '1', target: './trip', dark: true}), [
    './trip',
    '--dark',
  ]);
  assert.deepEqual(buildArgvFromChoices({choice: '2', target: './p', exif: true, sign: true}), [
    'still',
    './p',
    '--exif',
    '--sign',
  ]);
  assert.deepEqual(buildArgvFromChoices({choice: '2', target: './p'}), ['still', './p']);
  assert.deepEqual(buildArgvFromChoices({choice: '2', target: './p', dark: true}), [
    'still',
    './p',
    '--dark',
  ]);
  assert.deepEqual(buildArgvFromChoices({choice: '3', target: './trip'}), ['lyrics', './trip']);
  assert.deepEqual(buildArgvFromChoices({choice: '4'}), ['doctor']);
  assert.deepEqual(buildArgvFromChoices({choice: '5', target: './trip'}), ['fetch', './trip']);
  assert.equal(buildArgvFromChoices({choice: '9'}), null);
});

test('runMenu reports invalid choices and q exits cleanly', async () => {
  const {result, output} = await interact({lines: ['9', 'q']});
  assert.equal(result, null);
  assert.match(output, /无效选择,请输入 1-6/);
  assert.doesNotMatch(output, /回车 选默认 · 0 返回/);
  assert.match(output, /晚安。素材都在原文件夹,随时再来。/);
});

test('banner and farewell degrade to plain ASCII art without a TTY', () => {
  let text = '';
  const output = {write: (chunk) => { text += chunk; }};
  writeBanner(output);
  writeFarewell(output);
  assert.match(text, /tsuzuri 綴/);
  assert.match(text, /把照片和一首歌缀成影像日记/);
  assert.match(text, /晚安。素材都在原文件夹,随时再来。/);
  assert.doesNotMatch(text, /\x1b\[/);
});

test('runMenu repeats missing and wrong-type folder paths', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tsuzuri-menu-test-'));
  const file = path.join(root, 'photo.jpg');
  fs.writeFileSync(file, 'photo');
  try {
    const {result, output} = await interact({
      lines: ['1', path.join(root, 'missing'), file, root],
    });
    assert.deepEqual(result, [root]);
    assert.match(output, /找不到路径:/);
    assert.match(output, /不是文件夹:/);
  } finally {
    fs.rmSync(root, {recursive: true, force: true});
  }
});

test('path prompt returns to the menu on empty enter', async () => {
  const {result} = await interact({lines: ['3', '']});
  assert.equal(result, MENU_BACK);
});

test('still accepts a file path and defaults presentation choices to off', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tsuzuri-menu-test-'));
  const file = path.join(root, 'photo.jpg');
  fs.writeFileSync(file, 'photo');
  try {
    const {result, confirmCalls} = await interact({
      lines: ['2', file],
      confirms: [false, false, false],
    });
    assert.deepEqual(result, ['still', file]);
    assert.deepEqual(confirmCalls.map((call) => call.options), [
      {defaultValue: false, defaultLabel: '不显示', alternateKey: 'e', alternateLabel: '显示'},
      {defaultValue: false, defaultLabel: '不加入', alternateKey: 's', alternateLabel: '加入'},
      {defaultValue: false, defaultLabel: '不使用', alternateKey: 'd', alternateLabel: '使用'},
    ]);
  } finally {
    fs.rmSync(root, {recursive: true, force: true});
  }
});

test('render (choice 1) asks presentation questions and defaults to the project canvas', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tsuzuri-menu-test-'));
  try {
    const {result, confirmCalls} = await interact({
      lines: ['1', root],
      confirms: [true, false, true], picks: [{index: 0}],
    });
    assert.deepEqual(result, [root, '--exif', '--dark']);
    assert.deepEqual(confirmCalls.map((call) => call.options), [
      {defaultValue: false, defaultLabel: '不显示', alternateKey: 'e', alternateLabel: '显示'},
      {defaultValue: false, defaultLabel: '不加入', alternateKey: 's', alternateLabel: '加入'},
      {defaultValue: false, defaultLabel: '不使用', alternateKey: 'd', alternateLabel: '使用'},
    ]);
  } finally {
    fs.rmSync(root, {recursive: true, force: true});
  }
});

test('menu adds portrait and square presets to render and still argv', () => {
  assert.deepEqual(buildArgvFromChoices({choice: '1', target: './trip', portrait: true}), ['./trip', '--portrait']);
  assert.deepEqual(buildArgvFromChoices({choice: '2', target: './photo.jpg', square: true}), ['still', './photo.jpg', '--square']);
});

test('buildArgvFromChoices appends --filter only when a filter is chosen', () => {
  assert.deepEqual(buildArgvFromChoices({choice: '1', target: './trip', filter: 'mono'}), ['./trip', '--filter', 'mono']);
  assert.deepEqual(buildArgvFromChoices({choice: '2', target: './p', filter: 'riso'}), ['still', './p', '--filter', 'riso']);
  assert.deepEqual(buildArgvFromChoices({choice: '1', target: './trip', filter: null}), ['./trip']);
});

test('runMenu asks for a filter after the format pick and defaults to none on enter', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tsuzuri-menu-test-'));
  try {
    const {result} = await interact({
      lines: ['1', root],
      confirms: [false, false, false],
      picks: [{index: 0}, {index: 0}],
    });
    assert.deepEqual(result, [root]);
  } finally {
    fs.rmSync(root, {recursive: true, force: true});
  }
});

test('runMenu wires a chosen filter id into the equivalent argv', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tsuzuri-menu-test-'));
  try {
    const filterIndex = FILTER_IDS.indexOf('mono') + 1; // 0 号是「无滤镜」
    const {result} = await interact({
      lines: ['1', root],
      confirms: [false, false, false],
      picks: [{index: 0}, {index: filterIndex}],
    });
    assert.deepEqual(result, [root, '--filter', 'mono']);
  } finally {
    fs.rmSync(root, {recursive: true, force: true});
  }
});
