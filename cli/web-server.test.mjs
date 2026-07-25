import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {PassThrough} from 'node:stream';
import test from 'node:test';

import {createGalleryServer} from './web-server.mjs';

const makeTempRoot = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tsuzuri-web-server-'));

const listen = (server) =>
  new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));

// fetch() 会把用户传入的 Host 头当作禁止覆写的头忽略掉,拿不到伪造效果,
// 所以这里用 node:http 直连发请求,手动摆一个假的 Host 头来模拟 DNS rebinding。
const requestWithHost = (port, hostHeader) =>
  new Promise((resolve, reject) => {
    const req = http.request(
      {host: '127.0.0.1', port, path: '/api/dirs?path=.', method: 'GET', headers: {Host: hostHeader}},
      (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode));
      },
    );
    req.on('error', reject);
    req.end();
  });

test('rejects a request whose Host header does not match localhost/127.0.0.1:<port>(防 DNS rebinding)', async () => {
  const {server} = createGalleryServer(makeTempRoot());
  const port = await listen(server);
  try {
    const status = await requestWithHost(port, 'evil.example.com');
    assert.equal(status, 403);
  } finally {
    server.close();
  }
});

test('allows requests with a legit localhost/127.0.0.1 Host header matching the listening port', async () => {
  const {server} = createGalleryServer(makeTempRoot());
  const port = await listen(server);
  try {
    const viaLocalhost = await requestWithHost(port, `localhost:${port}`);
    assert.notEqual(viaLocalhost, 403);
    const viaLoopbackIp = await requestWithHost(port, `127.0.0.1:${port}`);
    assert.notEqual(viaLoopbackIp, 403);
  } finally {
    server.close();
  }
});

// ---- /api/jobs* ------------------------------------------------------------

/** 造一个假的 child_process.ChildProcess,避免测试真的起渲染进程。 */
const makeFakeChild = () => {
  const child = new EventEmitter();
  child.pid = 999;
  child.stdio = [null, new PassThrough(), new PassThrough(), new PassThrough()];
  child.kill = () => {};
  return child;
};

const postJson = (port, pathname, body, headers = {}) =>
  new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: pathname,
        method: 'POST',
        headers: {'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), ...headers},
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => resolve({status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')}));
      },
    );
    req.on('error', reject);
    req.end(payload);
  });

test('缺 token 的 POST /api/jobs → 403', async () => {
  const root = makeTempRoot();
  const {server} = createGalleryServer(root, {spawnImpl: makeFakeChild});
  const port = await listen(server);
  try {
    const res = await postJson(port, '/api/jobs', {kind: 'render', folder: root});
    assert.equal(res.status, 403);
  } finally {
    server.close();
  }
});

test('错误 token 的 POST /api/jobs → 403', async () => {
  const root = makeTempRoot();
  const {server} = createGalleryServer(root, {spawnImpl: makeFakeChild});
  const port = await listen(server);
  try {
    const res = await postJson(port, '/api/jobs', {kind: 'render', folder: root}, {'X-Tsuzuri-Token': 'wrong'});
    assert.equal(res.status, 403);
  } finally {
    server.close();
  }
});

test('带正确 token 的合法请求 → 201 并带 id;folder 越界时(带正确 token)→ 403', async () => {
  const root = makeTempRoot();
  const {server, token} = createGalleryServer(root, {spawnImpl: makeFakeChild});
  const port = await listen(server);
  try {
    const ok = await postJson(port, '/api/jobs', {kind: 'render', folder: root}, {'X-Tsuzuri-Token': token});
    assert.equal(ok.status, 201);
    assert.ok(ok.body.id);

    const outside = await postJson(
      port,
      '/api/jobs',
      {kind: 'render', folder: path.join(root, '..', '..')},
      {'X-Tsuzuri-Token': token},
    );
    assert.equal(outside.status, 403);
  } finally {
    server.close();
  }
});

test('并发第二个 POST /api/jobs → 409', async () => {
  const root = makeTempRoot();
  const {server, token} = createGalleryServer(root, {spawnImpl: makeFakeChild});
  const port = await listen(server);
  try {
    const first = await postJson(port, '/api/jobs', {kind: 'render', folder: root}, {'X-Tsuzuri-Token': token});
    assert.equal(first.status, 201);
    const second = await postJson(port, '/api/jobs', {kind: 'render', folder: root}, {'X-Tsuzuri-Token': token});
    assert.equal(second.status, 409);
  } finally {
    server.close();
  }
});

test('非法 options → 400 并带 field', async () => {
  const root = makeTempRoot();
  const {server, token} = createGalleryServer(root, {spawnImpl: makeFakeChild});
  const port = await listen(server);
  try {
    const res = await postJson(
      port,
      '/api/jobs',
      {kind: 'render', folder: root, options: {format: 'bogus'}},
      {'X-Tsuzuri-Token': token},
    );
    assert.equal(res.status, 400);
    assert.equal(res.body.field, 'format');
  } finally {
    server.close();
  }
});

test('SSE:客户端断开后 unsubscribe 被调用,server 保持健康(job 仍 running 而非崩溃)', async () => {
  const root = makeTempRoot();
  let spawnedChild;
  const spawnImpl = () => {
    spawnedChild = makeFakeChild();
    return spawnedChild;
  };
  const {server, token} = createGalleryServer(root, {spawnImpl});
  const port = await listen(server);
  try {
    const created = await postJson(port, '/api/jobs', {kind: 'render', folder: root}, {'X-Tsuzuri-Token': token});
    assert.equal(created.status, 201);
    const {id} = created.body;

    const sseReq = http.request({host: '127.0.0.1', port, path: `/api/jobs/${id}/events`, method: 'GET'});
    const connected = new Promise((resolve) => sseReq.on('response', (res) => resolve(res)));
    sseReq.end();
    await connected;

    // 给 subscribeEvents 一点时间把监听者挂上,再销毁连接触发 req.on('close')。
    await new Promise((resolve) => setImmediate(resolve));
    sseReq.destroy();
    await new Promise((resolve) => setTimeout(resolve, 50));

    // job 内部监听者集合是否归零已经在 web-api/jobs.test.mjs 里通过
    // _debugListenerCount 直接断言过;这里换一层验证:HTTP server 在客户端
    // 断开后没有因为 unsubscribe 抛错而崩溃,依然能正常响应后续请求。
    const stillOk = await new Promise((resolve, reject) => {
      const req = http.request(
        {host: '127.0.0.1', port, path: `/api/jobs/${id}`, method: 'GET'},
        (res) => {
          const chunks = [];
          res.on('data', (chunk) => chunks.push(chunk));
          res.on('end', () => resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))));
        },
      );
      req.on('error', reject);
      req.end();
    });
    assert.equal(stillOk.status, 'running');
    spawnedChild.emit('exit', 0);
  } finally {
    server.close();
  }
});
