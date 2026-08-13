import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import test from 'node:test';

import {createKisekiService} from './kiseki-service.mjs';
import {createMutableRootController} from './root-controller.mjs';

test('native service starts without an authorized root and switches only to a canonical directory', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kiseki-service-root-'));
  const service = createKisekiService({rootController: createMutableRootController(), projectSelection: 'native', startPort: 0});
  const started = await service.start();
  const response = await fetch(started.url);
  assert.equal(response.status, 200);
  const runtime = await fetch(`${started.url}/api/runtime`);
  assert.deepEqual(await runtime.json(), {projectSelection: 'native', root: null});
  assert.equal((await fetch(`${started.url}/api/dirs?path=.`)).status, 409);
  assert.throws(() => service.getRoot(), /尚未授权/);
  assert.equal(service.switchRoot(root).path, fs.realpathSync(root));
  assert.deepEqual(await (await fetch(`${started.url}/api/runtime`)).json(), {projectSelection: 'native', root: fs.realpathSync(root)});
  await service.shutdown();
  fs.rmSync(root, {recursive: true});
});

test('invalid switch preserves current root', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kiseki-service-root-'));
  const service = createKisekiService({rootController: createMutableRootController({initialRoot: root})});
  assert.throws(() => service.switchRoot(path.join(root, 'missing')));
  assert.equal(service.getRoot().path, fs.realpathSync(root));
  fs.rmSync(root, {recursive: true});
});

test('shutdown closes keep-alive connections within its deadline', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kiseki-service-root-'));
  const service = createKisekiService({rootController: createMutableRootController({initialRoot: root}), startPort: 0});
  const {port} = await service.start();
  const agent = new http.Agent({keepAlive: true});
  await new Promise((resolve, reject) => {
    http.get({host: '127.0.0.1', port, path: '/', agent}, (response) => {
      response.resume();
      response.on('end', resolve);
    }).on('error', reject);
  });
  const started = Date.now();
  assert.deepEqual(await service.shutdown({deadlineMs: 500}), {clean: true});
  assert.ok(Date.now() - started < 500);
  agent.destroy();
  fs.rmSync(root, {recursive: true});
});

test('shutdown aborts an active search before reporting clean', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kiseki-service-root-'));
  let startedResolve;
  const startedRun = new Promise((resolve) => { startedResolve = resolve; });
  let aborted = false;
  const runImpl = (_command, _args, {signal}) => new Promise((resolve) => {
    startedResolve();
    signal.addEventListener('abort', () => {
      aborted = true;
      resolve({status: null, stdout: '', stderr: ''});
    }, {once: true});
  });
  const service = createKisekiService({rootController: createMutableRootController({initialRoot: root}), startPort: 0, serverDeps: {runImpl}});
  const {url} = await service.start();
  const request = fetch(`${url}/api/fetch/audio-search?q=song`, {headers: {'x-kiseki-token': service.token}});
  await startedRun;
  assert.deepEqual(await service.shutdown({deadlineMs: 500}), {clean: true});
  assert.equal(aborted, true);
  assert.equal((await request).status, 503);
  fs.rmSync(root, {recursive: true});
});

test('shutdown reports unclean when an active handler ignores cancellation', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kiseki-service-root-'));
  let startedResolve;
  const startedRun = new Promise((resolve) => { startedResolve = resolve; });
  const runImpl = () => {
    startedResolve();
    return new Promise(() => {});
  };
  const service = createKisekiService({rootController: createMutableRootController({initialRoot: root}), startPort: 0, serverDeps: {runImpl}});
  const {url} = await service.start();
  const request = fetch(`${url}/api/fetch/audio-search?q=song`, {headers: {'x-kiseki-token': service.token}}).catch(() => null);
  await startedRun;
  assert.deepEqual(await service.shutdown({deadlineMs: 50}), {clean: false});
  assert.equal(await request, null);
  fs.rmSync(root, {recursive: true});
});
