import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {CliError} from './options.mjs';
import {createRuntimeLayout} from './runtime-layout.mjs';
import {term} from './term.mjs';
import {runWeb} from './web.mjs';

const makeTempRoot = () => fs.mkdtempSync(path.join(os.tmpdir(), 'kiseki-web-'));

const makeWebRuntime = ({withIndex = true} = {}) => {
  const webDist = fs.mkdtempSync(path.join(os.tmpdir(), 'kiseki-web-dist-'));
  if (withIndex) {
    fs.writeFileSync(
      path.join(webDist, 'index.html'),
      '<!doctype html><html><body>kiseki 本地工作台</body></html>',
    );
  }
  return createRuntimeLayout({webDist});
};

const closeServer = (server) => new Promise((resolve, reject) => {
  server.close((error) => error ? reject(error) : resolve());
});

const runWebSilently = async (...args) => {
  const originals = {success: term.success, detail: term.detail};
  term.success = () => {};
  term.detail = () => {};
  try {
    return await runWeb(...args);
  } finally {
    Object.assign(term, originals);
  }
};

/** 与 web.mjs 的 START_PORT 保持一致. */
const START_PORT = 3000;

test('starts a server on a free port and serves the frontend', async () => {
  const folder = makeTempRoot();
  const runtime = makeWebRuntime();
  const server = await runWebSilently(folder, {openBrowser: false, runtime});
  try {
    const {port} = server.address();
    assert.ok(port > 0);
    const response = await fetch(`http://localhost:${port}/`);
    assert.equal(response.status, 200);
    const text = await response.text();
    assert.match(text, /(kiseki 本地工作台|軌跡｜kiseki)/);
  } finally {
    await closeServer(server);
  }
});

test('rejects when webDist has no index.html', async () => {
  const folder = makeTempRoot();
  const runtime = makeWebRuntime({withIndex: false});
  await assert.rejects(
    () => runWeb(folder, {openBrowser: false, runtime}),
    (error) => error instanceof CliError && /setup\.sh/.test(error.message),
  );
});

test('rejects a folder argument that does not exist', async () => {
  await assert.rejects(() => runWeb('/no/such/folder/kiseki-test'), CliError);
});

/**
 * 占住起始端口.如果它已经被机器上别的进程占着(开发时很常见:另开着一个
 * kiseki web),前置条件本来就满足了,不必也不能再占一次 —— 这个用例真正要
 * 断言的是"起始端口不可用时会往后找",谁占的无所谓.
 */
const occupyStartPort = async () => {
  const blocker = net.createServer();
  try {
    await new Promise((resolve, reject) => {
      blocker.once('error', reject);
      blocker.listen(START_PORT, '127.0.0.1', resolve);
    });
    return () => closeServer(blocker);
  } catch (error) {
    if (error.code !== 'EADDRINUSE') throw error;
    return async () => {};
  }
};

test('picks the next free port when the first one is occupied', async () => {
  const release = await occupyStartPort();
  try {
    const folder = makeTempRoot();
    const runtime = makeWebRuntime();
    const server = await runWebSilently(folder, {openBrowser: false, runtime});
    try {
      assert.notEqual(server.address().port, START_PORT);
    } finally {
      await closeServer(server);
    }
  } finally {
    await release();
  }
});
