import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import {installTool, prependToolPaths, toolCommand} from './setup-tools.mjs';

test('tool commands stay fixed for macOS and Windows', () => {
  assert.deepEqual(toolCommand('uv', 'darwin').args, ['-lc', 'curl -LsSf https://astral.sh/uv/install.sh | sh']);
  assert.equal(toolCommand('uv', 'win32').command, 'powershell.exe');
  assert.deepEqual(toolCommand('ffmpeg', 'darwin').args, ['install', 'ffmpeg']);
  assert.equal(toolCommand('ffmpeg', 'win32').command, 'winget');
  assert.equal(toolCommand('ffmpeg', 'linux'), null);
  assert.equal(toolCommand('node', 'darwin'), null);
});

test('installTool does not run an unsupported tool', async () => {
  let spawned = false;
  const result = await installTool({tool: 'ffmpeg', platform: 'linux', spawnImpl: () => { spawned = true; }});
  assert.equal(result.status, 400);
  assert.equal(spawned, false);
});

test('prependToolPaths adds the user tool bin once', () => {
  const env = {PATH: '/usr/bin'};
  prependToolPaths(env, {platform: 'darwin', home: '/Users/me'});
  const expected = ['/Users/me/.local/bin', '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin'].join(path.delimiter);
  assert.equal(env.PATH, expected);
  prependToolPaths(env, {platform: 'darwin', home: '/Users/me'});
  assert.equal(env.PATH, expected);
});
