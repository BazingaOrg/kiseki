import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const source = (name) => readFile(new URL(`../src/${name}`, import.meta.url), 'utf8');

test('desktop service declares native project selection and menu changes use IPC', async () => {
  const main = await source('main.mjs');
  assert.match(main, /projectSelection: 'native'/);
  assert.match(main, /webContents\.send\('kiseki:project-changed', snapshot\.path\)/);
  assert.match(main, /authorizeProject\(candidate, \{notify: true\}\)/);
  assert.doesNotMatch(main, /authorizeProject\(candidate, \{reload: true\}\)/);
});

test('preload exposes a removable project change subscription', async () => {
  const preload = await source('preload.cjs');
  assert.match(preload, /onProjectChanged: \(callback\) =>/);
  assert.match(preload, /ipcRenderer\.removeListener\('kiseki:project-changed', listener\)/);
});

test('desktop exit uses bounded service shutdown and exits without re-entering before-quit', async () => {
  const main = await source('main.mjs');
  assert.match(main, /if \(app\.isQuitting\) \{ event\.preventDefault\(\); return; \}/);
  assert.match(main, /service\?\.shutdown\(\{deadlineMs: 8000\}\)/);
  assert.match(main, /app\.exit\(result\.clean \? 0 : 1\)/);
  assert.doesNotMatch(main, /finally\(\(\) => app\.quit\(\)\)/);
});
