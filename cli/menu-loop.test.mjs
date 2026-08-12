import assert from 'node:assert/strict';
import test from 'node:test';

import {PromptAbortError, PromptQuitError} from './prompts.mjs';
import {MENU_BACK} from './menu.mjs';
import {CliError} from './options.mjs';
import {runInteractiveMenu} from './kiseki.mjs';

test('interactive menu runs consecutive commands until the user exits', async () => {
  const choices = [['doctor'], ['lyrics', '/trip'], null];
  const commands = [];
  let output = '';

  const code = await runInteractiveMenu({
    menuRunner: async () => choices.shift(),
    commandRunner: async (argv) => {
      commands.push(argv);
      return 0;
    },
    output: {write: (text) => { output += text; }},
  });

  assert.equal(code, 0);
  assert.deepEqual(commands, [['doctor'], ['lyrics', '/trip']]);
  assert.equal((output.match(/返回主菜单/g) ?? []).length, 2);
  assert.equal((output.match(/kiseki 軌跡/g) ?? []).length, 2);
});

test('a command error is reported and does not exit the interactive menu', async () => {
  const choices = [['lyrics', '/missing'], null];
  const errors = [];
  let output = '';

  assert.equal(await runInteractiveMenu({
    menuRunner: async () => choices.shift(),
    commandRunner: async () => { throw new Error('找不到路径'); },
    onError: (error) => errors.push(error.message),
    output: {write: (text) => { output += text; }},
  }), 0);
  assert.deepEqual(errors, ['找不到路径']);
  assert.match(output, /kiseki 軌跡/);
});

test('back from a menu question redraws the menu without running a command', async () => {
  const choices = [MENU_BACK, null];
  let commandCount = 0;
  let output = '';
  assert.equal(await runInteractiveMenu({
    menuRunner: async () => choices.shift(),
    commandRunner: async () => { commandCount += 1; },
    output: {write: (text) => { output += text; }},
  }), 0);
  assert.equal(commandCount, 0);
  assert.match(output, /kiseki 軌跡/);
});

test('q exits the whole interactive menu while Ctrl+C remains an interruption', async () => {
  let output = '';
  assert.equal(await runInteractiveMenu({
    menuRunner: async () => ['fetch', '/trip'],
    commandRunner: async () => { throw new PromptQuitError(); },
    output: {write: (text) => { output += text; }},
  }), 0);
  assert.match(output, /晚安.素材都在原位置,随时再来./);

  await assert.rejects(runInteractiveMenu({
    menuRunner: async () => { throw new PromptAbortError(); },
    output: {write: () => {}},
  }), PromptAbortError);
});

test('choosing web hands the terminal over and stops questioning', async () => {
  const choices = [['web'], ['doctor']];
  const commands = [];
  let menuCalls = 0;
  let output = '';

  const code = await runInteractiveMenu({
    menuRunner: async () => { menuCalls += 1; return choices.shift(); },
    commandRunner: async (argv) => { commands.push(argv); return 0; },
    output: {write: (text) => { output += text; }},
  });

  assert.equal(code, 0);
  assert.deepEqual(commands, [['web']]);
  assert.equal(menuCalls, 1);
  assert.doesNotMatch(output, /返回主菜单/);
  assert.match(output, /本地工作台已接管这个终端/);
});

test('a failed web launch still returns to the menu', async () => {
  const choices = [['web'], null];
  const errors = [];
  let output = '';

  const code = await runInteractiveMenu({
    menuRunner: async () => choices.shift(),
    commandRunner: async (argv) => {
      if (argv[0] === 'web') throw new CliError('端口被占用');
      return 0;
    },
    onError: (error) => errors.push(error.message),
    output: {write: (text) => { output += text; }},
  });

  assert.equal(code, 0);
  assert.deepEqual(errors, ['端口被占用']);
  assert.match(output, /返回主菜单/);
});

test('web returning a non-zero exit code is not treated as resident', async () => {
  const choices = [['web'], null];
  let menuCalls = 0;

  const code = await runInteractiveMenu({
    menuRunner: async () => { menuCalls += 1; return choices.shift(); },
    commandRunner: async () => 1,
    output: {write: () => {}},
  });

  assert.equal(code, 0);
  assert.equal(menuCalls, 2);
});
