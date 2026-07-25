import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {CliError} from './options.mjs';
import {runWeb} from './web.mjs';

const makeTempRoot = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tsuzuri-web-'));

test('starts a server on a free port and serves the frontend (or placeholder if unbuilt)', async () => {
  const folder = makeTempRoot();
  const server = await runWeb(folder, {openBrowser: false});
  try {
    const {port} = server.address();
    assert.ok(port > 0);
    const response = await fetch(`http://localhost:${port}/`);
    assert.equal(response.status, 200);
    const text = await response.text();
    // web/dist 存在时 serve 真实构建产物,否则回退占位页——两者皆为合法状态
    assert.match(text, /(tsuzuri 本地画廊|綴り｜tsuzuri)/);
  } finally {
    server.close();
  }
});

test('rejects a folder argument that does not exist', async () => {
  await assert.rejects(() => runWeb('/no/such/folder/tsuzuri-test'), CliError);
});

test('picks the next free port when the first one is occupied', async () => {
  const blocker = net.createServer();
  await new Promise((resolve) => blocker.listen(3000, '127.0.0.1', resolve));
  try {
    const folder = makeTempRoot();
    const server = await runWeb(folder, {openBrowser: false});
    try {
      assert.notEqual(server.address().port, 3000);
    } finally {
      server.close();
    }
  } finally {
    blocker.close();
  }
});
