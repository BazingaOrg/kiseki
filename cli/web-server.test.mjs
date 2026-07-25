import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
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
  const server = createGalleryServer(makeTempRoot());
  const port = await listen(server);
  try {
    const status = await requestWithHost(port, 'evil.example.com');
    assert.equal(status, 403);
  } finally {
    server.close();
  }
});

test('allows requests with a legit localhost/127.0.0.1 Host header matching the listening port', async () => {
  const server = createGalleryServer(makeTempRoot());
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
