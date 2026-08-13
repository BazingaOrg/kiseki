import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {PassThrough} from 'node:stream';
import test from 'node:test';
import {fileURLToPath} from 'node:url';

import {createGalleryServer} from './web-server.mjs';
import {createDoctorService} from './web-api/doctor.mjs';
import {createTaskLeaseManager} from './task-lease.mjs';

const makeTempRoot = () => fs.mkdtempSync(path.join(os.tmpdir(), 'kiseki-web-server-'));

const listen = (server) =>
  new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));

// fetch() 会把用户传入的 Host 头当作禁止覆写的头忽略掉,拿不到伪造效果,
// 所以这里用 node:http 直连发请求,手动摆一个假的 Host 头来模拟 DNS rebinding.
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
  const {server} = createTestGalleryServer(makeTempRoot());
  const port = await listen(server);
  try {
    const status = await requestWithHost(port, 'evil.example.com');
    assert.equal(status, 403);
  } finally {
    server.close();
  }
});

test('allows requests with a legit localhost/127.0.0.1 Host header matching the listening port', async () => {
  const {server} = createTestGalleryServer(makeTempRoot());
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

test('/api/thumb 304 writes no body/content-length and never opens a read stream', async () => {
  const root = makeTempRoot();
  const image = path.join(root, 'image.jpg');
  fs.writeFileSync(image, 'source');
  let opened = 0;
  const {server} = createTestGalleryServer(root, {
    thumbDeps: {
      cacheDir: path.join(root, 'thumb-cache'),
      generator: async (_source, destination) => { fs.writeFileSync(destination, 'thumb'); return true; },
    },
    createReadStream: (...args) => { opened += 1; return fs.createReadStream(...args); },
  });
  const port = await listen(server);
  const endpoint = `/api/thumb?path=${encodeURIComponent(image)}&w=400`;
  try {
    const first = await fetch(`http://127.0.0.1:${port}${endpoint}`);
    assert.equal(first.status, 200);
    const etag = first.headers.get('etag');
    await first.arrayBuffer();
    assert.equal(opened, 1);
    const second = await fetch(`http://127.0.0.1:${port}${endpoint}`, {headers: {'If-None-Match': `W/${etag}, "other"`}});
    assert.equal(second.status, 304);
    assert.equal(second.headers.get('content-length'), null);
    assert.equal(await second.text(), '');
    assert.equal(opened, 1);
  } finally {
    server.close();
  }
});

test('/api/thumb errors remain errors even when If-None-Match is supplied', async () => {
  const root = makeTempRoot();
  const {server} = createTestGalleryServer(root);
  const port = await listen(server);
  try {
    const missing = await fetch(`http://127.0.0.1:${port}/api/thumb?path=${encodeURIComponent(path.join(root, 'missing.jpg'))}`, {headers: {'If-None-Match': '*'}});
    const escaped = await fetch(`http://127.0.0.1:${port}/api/thumb?path=${encodeURIComponent('/etc/passwd')}`, {headers: {'If-None-Match': '*'}});
    assert.equal(missing.status, 404);
    assert.equal(escaped.status, 403);
  } finally {
    server.close();
  }
});

test('静态资源缓存:assets 产物 immutable,index.html 不缓存,根级文件带 ETag 可 304', async (t) => {
  const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web', 'dist');
  if (!fs.existsSync(dist)) {
    t.skip('web/dist 未构建,跳过静态缓存头测试');
    return;
  }
  const assetsDir = path.join(dist, 'assets');
  fs.mkdirSync(assetsDir, {recursive: true});
  const hashed = path.join(assetsDir, 'index-testhash.js');
  const rootFile = path.join(dist, '.cache-test.txt');
  fs.writeFileSync(hashed, 'console.log(1)');
  fs.writeFileSync(rootFile, 'favicon-ish');
  const {server} = createTestGalleryServer(makeTempRoot());
  const port = await listen(server);
  try {
    const asset = await fetch(`http://127.0.0.1:${port}/assets/index-testhash.js`);
    assert.equal(asset.status, 200);
    assert.equal(asset.headers.get('cache-control'), 'public, max-age=31536000, immutable');

    const root = await fetch(`http://127.0.0.1:${port}/.cache-test.txt`);
    assert.equal(root.status, 200);
    const etag = root.headers.get('etag');
    assert.ok(etag, '根级文件应有 ETag');
    assert.equal(root.headers.get('cache-control'), 'private, no-cache');

    const revalidate = await fetch(`http://127.0.0.1:${port}/.cache-test.txt`, {headers: {'If-None-Match': etag}});
    assert.equal(revalidate.status, 304);
    assert.equal(await revalidate.text(), '');

    const index = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(index.status, 200);
    assert.equal(index.headers.get('cache-control'), 'private, no-cache');
  } finally {
    server.close();
    fs.rmSync(hashed, {force: true});
    fs.rmSync(rootFile, {force: true});
  }
});

// ---- /api/jobs* ------------------------------------------------------------

const TEST_EXECUTOR_START = 'Mon Jan  1 00:00:00 2024';

/** 造一个假的 child_process.ChildProcess,避免测试真的起渲染进程. */
const makeFakeChild = () => {
  const child = new EventEmitter();
  child.pid = 999;
  child.stdio = [null, new PassThrough(), new PassThrough(), new PassThrough()];
  child.kill = () => {};
  return child;
};

/** HTTP 路由测试不应碰真实任务 lease 或宿主进程表. */
const makeJobManagerDeps = () => {
  let nextId = 0;
  return {
    leaseManager: {
      acquire: () => {
        const taskRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kiseki-web-job-'));
        return {id: `web-job-${++nextId}`, token: 'test-token', taskRoot};
      },
      markSpawnIntent: () => {},
      registerExecutor: (_lease, executor) => ({pid: executor.pid, start: TEST_EXECUTOR_START}),
      release: (lease) => { fs.rmSync(lease.taskRoot, {recursive: true, force: true}); return true; },
    },
    readProcessTable: () => `999 1 ${TEST_EXECUTOR_START}\n`,
  };
};

const createTestGalleryServer = (root, deps = {}) => createGalleryServer(root, {
  ...deps,
  jobManagerDeps: makeJobManagerDeps(),
  assetMutationDeps: {
    leaseManager: createTaskLeaseManager({registryRoot: path.join(root, '.test-runtime', 'asset-leases')}),
  },
});

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

test('asset recovery HTTP exposes only its opaque retry id and required flag', async () => {
  const root = makeTempRoot();
  const metadata = path.join(root, 'output', 'metadata');
  fs.mkdirSync(metadata, {recursive: true});
  fs.writeFileSync(path.join(metadata, 'lyrics.json'), JSON.stringify({segments: [{text: 'line', start: 0}]}));
  fs.writeFileSync(path.join(metadata, 'timeline.json'), '{}');
  const {server, token} = createTestGalleryServer(root);
  const port = await listen(server);
  try {
    const cleared = await postJson(port, '/api/assets/recognized-lyrics/clear', {folder: root}, {'X-Kiseki-Token': token});
    assert.equal(cleared.status, 200);
    const operation = path.join(root, '.kiseki-trash', cleared.body.undoId);
    const bad = path.join(operation, 'files', 'output', 'metadata', 'timeline.json');
    fs.rmSync(bad);
    fs.mkdirSync(bad);
    const undone = await postJson(port, '/api/assets/undo', {folder: root, undoId: cleared.body.undoId}, {'X-Kiseki-Token': token});
    assert.equal(undone.status, 409);
    assert.equal(undone.body.recoveryUndoId, cleared.body.undoId);
    assert.equal(undone.body.recoveryRequired, true);
    assert.equal(JSON.stringify(undone.body).includes(root), false);
  } finally { server.close(); fs.rmSync(root, {recursive: true, force: true}); }
});

test('缺 token 的 POST /api/jobs → 403', async () => {
  const root = makeTempRoot();
  const {server} = createTestGalleryServer(root, {spawnImpl: makeFakeChild});
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
  const {server} = createTestGalleryServer(root, {spawnImpl: makeFakeChild});
  const port = await listen(server);
  try {
    const res = await postJson(port, '/api/jobs', {kind: 'render', folder: root}, {'X-Kiseki-Token': 'wrong'});
    assert.equal(res.status, 403);
  } finally {
    server.close();
  }
});

test('带正确 token 的合法请求 → 201 并带 id;folder 越界时(带正确 token)→ 403', async () => {
  const root = makeTempRoot();
  const {server, token} = createTestGalleryServer(root, {spawnImpl: makeFakeChild});
  const port = await listen(server);
  try {
    const ok = await postJson(port, '/api/jobs', {kind: 'render', folder: root}, {'X-Kiseki-Token': token});
    assert.equal(ok.status, 201);
    assert.ok(ok.body.id);

    const outside = await postJson(
      port,
      '/api/jobs',
      {kind: 'render', folder: path.join(root, '..', '..')},
      {'X-Kiseki-Token': token},
    );
    assert.equal(outside.status, 403);
  } finally {
    server.close();
  }
});

test('并发第二个 POST /api/jobs → 409', async () => {
  const root = makeTempRoot();
  const {server, token} = createTestGalleryServer(root, {spawnImpl: makeFakeChild});
  const port = await listen(server);
  try {
    const first = await postJson(port, '/api/jobs', {kind: 'render', folder: root}, {'X-Kiseki-Token': token});
    assert.equal(first.status, 201);
    const second = await postJson(port, '/api/jobs', {kind: 'render', folder: root}, {'X-Kiseki-Token': token});
    assert.equal(second.status, 409);
  } finally {
    server.close();
  }
});

test('非法 options → 400 并带 field', async () => {
  const root = makeTempRoot();
  const {server, token} = createTestGalleryServer(root, {spawnImpl: makeFakeChild});
  const port = await listen(server);
  try {
    const res = await postJson(
      port,
      '/api/jobs',
      {kind: 'render', folder: root, options: {format: 'bogus'}},
      {'X-Kiseki-Token': token},
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
  const {server, token} = createTestGalleryServer(root, {spawnImpl});
  const port = await listen(server);
  try {
    const created = await postJson(port, '/api/jobs', {kind: 'render', folder: root}, {'X-Kiseki-Token': token});
    assert.equal(created.status, 201);
    const {id} = created.body;

    const sseReq = http.request({host: '127.0.0.1', port, path: `/api/jobs/${id}/events`, method: 'GET'});
    const connected = new Promise((resolve) => sseReq.on('response', (res) => resolve(res)));
    sseReq.end();
    await connected;

    // 给 subscribeEvents 一点时间把监听者挂上,再销毁连接触发 req.on('close').
    await new Promise((resolve) => setImmediate(resolve));
    sseReq.destroy();
    await new Promise((resolve) => setTimeout(resolve, 50));

    // job 内部监听者集合是否归零已经在 web-api/jobs.test.mjs 里通过
    // _debugListenerCount 直接断言过;这里换一层验证:HTTP server 在客户端
    // 断开后没有因为 unsubscribe 抛错而崩溃,依然能正常响应后续请求.
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


test('空闲时 GET /api/jobs/current → 200 且 job 为 null', async () => {
  const root = makeTempRoot();
  const {server} = createTestGalleryServer(root, {spawnImpl: makeFakeChild});
  const port = await listen(server);
  try {
    const res = await new Promise((resolve, reject) => {
      const req = http.request(
        {host: '127.0.0.1', port, path: '/api/jobs/current', method: 'GET'},
        (res) => {
          const chunks = [];
          res.on('data', (chunk) => chunks.push(chunk));
          res.on('end', () => resolve({status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString('utf8'))}));
        },
      );
      req.on('error', reject);
      req.end();
    });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, {job: null});
  } finally {
    server.close();
  }
});

test('创建任务后 GET /api/jobs/current → 返回该任务的 id/kind/folder', async () => {
  const root = makeTempRoot();
  const {server, token} = createTestGalleryServer(root, {spawnImpl: makeFakeChild});
  const port = await listen(server);
  try {
    const created = await postJson(port, '/api/jobs', {kind: 'render', folder: root}, {'X-Kiseki-Token': token});
    assert.equal(created.status, 201);

    const res = await new Promise((resolve, reject) => {
      const req = http.request(
        {host: '127.0.0.1', port, path: '/api/jobs/current', method: 'GET'},
        (res) => {
          const chunks = [];
          res.on('data', (chunk) => chunks.push(chunk));
          res.on('end', () => resolve({status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString('utf8'))}));
        },
      );
      req.on('error', reject);
      req.end();
    });
    assert.equal(res.status, 200);
    // resolveSafePath 会把 folder 解析成真实路径,macOS 上 /tmp 是指向 /private/tmp
    // 的符号链接,所以这里跟 root 比较前也要走一遍 realpath,否则本地必过、CI 也过,
    // 但字面量比较会因为符号链接被展开而误报.
    assert.deepEqual(res.body, {job: {id: created.body.id, kind: 'render', folder: fs.realpathSync(root)}});
  } finally {
    server.close();
  }
});

test('POST /api/jobs/current → 405(不在 isAllowedPostRoute 白名单,落入全局 405 拦截)', async () => {
  const root = makeTempRoot();
  const {server} = createTestGalleryServer(root, {spawnImpl: makeFakeChild});
  const port = await listen(server);
  try {
    const res = await postJson(port, '/api/jobs/current', {});
    assert.equal(res.status, 405);
  } finally {
    server.close();
  }
});

const getJson = (port, pathname, token = null) =>
  new Promise((resolve, reject) => {
    const headers = token === null ? {} : {'X-Kiseki-Token': token};
    const req = http.request({host: '127.0.0.1', port, path: pathname, method: 'GET', headers}, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () =>
        resolve({status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')}));
    });
    req.on('error', reject);
    req.end();
  });

test('GET /api/doctor awaits the instance service, forwards refresh, and maps errors to 500', async () => {
  const refreshes = [];
  const doctorGet = ({refresh}) => {
    refreshes.push(refresh);
    if (refresh) return Promise.reject(new Error('unexpected'));
    return Promise.resolve({status: 200, body: {ok: true, checks: []}});
  };
  const {server} = createTestGalleryServer(makeTempRoot(), {doctorGet});
  const port = await listen(server);
  try {
    assert.equal((await getJson(port, '/api/doctor')).status, 200);
    const failed = await getJson(port, '/api/doctor?refresh=1');
    assert.equal(failed.status, 500);
    assert.deepEqual(refreshes, [false, true]);
  } finally {
    server.close();
  }
});

test('GET /api/doctor keeps missing dependencies as a cached 200 response', async () => {
  let calls = 0;
  const doctor = createDoctorService({
    now: () => 1000,
    collect: async () => {
      calls += 1;
      return [
        {id: 'node', ok: true, line: 'node v22 可用'},
        {id: 'uv', ok: false, line: 'uv 未找到', fix: '安装 uv'},
      ];
    },
  });
  const {server} = createTestGalleryServer(makeTempRoot(), {doctorGet: doctor.getDoctor});
  const port = await listen(server);
  try {
    const first = await getJson(port, '/api/doctor');
    const second = await getJson(port, '/api/doctor');
    assert.equal(first.status, 200);
    assert.equal(first.body.ok, false);
    assert.deepEqual(second.body, first.body);
    assert.equal(calls, 1);
  } finally {
    server.close();
  }
});

/** 假的异步进程执行器:单测一律不联网、不起 yt-dlp/curl/ffprobe. */
const missingYtDlpRun = async () => ({status: null, stdout: '', stderr: ''});

test('GET /api/fetch/lyrics-search:folder 越界 → 403', async () => {
  const root = makeTempRoot();
  const {server} = createTestGalleryServer(root, {spawnImpl: makeFakeChild, runImpl: missingYtDlpRun});
  const port = await listen(server);
  try {
    const outside = encodeURIComponent(path.join(root, '..', '..'));
    const res = await getJson(port, `/api/fetch/lyrics-search?folder=${outside}`);
    assert.equal(res.status, 403);
  } finally {
    server.close();
  }
});

test('GET /api/fetch/audio-search:缺 yt-dlp → 503 并带安装提示', async () => {
  const root = makeTempRoot();
  const {server, token} = createTestGalleryServer(root, {spawnImpl: makeFakeChild, runImpl: missingYtDlpRun});
  const port = await listen(server);
  try {
    const res = await getJson(port, '/api/fetch/audio-search?q=song', token);
    assert.equal(res.status, 503);
    assert.match(res.body.fix, /yt-dlp/);
  } finally {
    server.close();
  }
});

test('POST /api/fetch/lyrics:缺 token / 错 token → 403(在碰文件系统之前)', async () => {
  const root = makeTempRoot();
  const {server} = createTestGalleryServer(root, {spawnImpl: makeFakeChild, runImpl: missingYtDlpRun});
  const port = await listen(server);
  try {
    const missing = await postJson(port, '/api/fetch/lyrics', {folder: root, id: 1});
    assert.equal(missing.status, 403);
    const wrong = await postJson(port, '/api/fetch/lyrics', {folder: root, id: 1}, {'X-Kiseki-Token': 'wrong'});
    assert.equal(wrong.status, 403);
  } finally {
    server.close();
  }
});

test('POST /api/fetch/lyrics:带正确 token 但 folder 越界 → 403', async () => {
  const root = makeTempRoot();
  const {server, token} = createTestGalleryServer(root, {spawnImpl: makeFakeChild, runImpl: missingYtDlpRun});
  const port = await listen(server);
  try {
    const res = await postJson(
      port,
      '/api/fetch/lyrics',
      {folder: path.join(root, '..', '..'), id: 1},
      {'X-Kiseki-Token': token},
    );
    assert.equal(res.status, 403);
  } finally {
    server.close();
  }
});

test('POST /api/fetch/lyrics-validate uses the service analyzer resolver', async () => {
  const root = fs.realpathSync(makeTempRoot());
  fs.writeFileSync(path.join(root, 'Song - Artist.m4a'), 'audio');
  let analyzerInvocation;
  const commandResolver = {
    runtime: {tempRoot: root},
    analyzer: (_entry, args) => ({executable: '/bundled/uv', args: ['run', '--offline', ...args], env: {UV_NO_INDEX: '1'}}),
  };
  const runImpl = async (command, args, options) => {
    if (command === '/bundled/uv') {
      analyzerInvocation = {command, args, options};
      const output = args[args.indexOf('--lyrics-output') + 1];
      fs.writeFileSync(output, JSON.stringify({segments: [{start: 1, text: 'hello'}]}));
      return {status: 0, stdout: '', stderr: ''};
    }
    return {status: 0, stdout: `${JSON.stringify({id: 42, trackName: 'Song', artistName: 'Artist', duration: 180, syncedLyrics: '[00:01.00]hello\n'})}\n200`, stderr: ''};
  };
  const {server, token} = createTestGalleryServer(root, {runImpl, commandResolver});
  const port = await listen(server);
  try {
    const response = await postJson(port, '/api/fetch/lyrics-validate', {folder: root, id: 42}, {'X-Kiseki-Token': token});
    assert.equal(response.status, 200);
    assert.equal(analyzerInvocation.command, '/bundled/uv');
    assert.equal(analyzerInvocation.options.env.UV_NO_INDEX, '1');
  } finally {
    server.close();
    fs.rmSync(root, {recursive: true, force: true});
  }
});

test('GET /api/fetch/lyrics 不是 SPA 路由,回 405 而不是页面', async () => {
  const root = makeTempRoot();
  const {server} = createTestGalleryServer(root, {spawnImpl: makeFakeChild, runImpl: missingYtDlpRun});
  const port = await listen(server);
  try {
    const status = await new Promise((resolve, reject) => {
      const req = http.request(
        {host: '127.0.0.1', port, path: '/api/fetch/lyrics', method: 'GET'},
        (res) => {
          res.resume();
          res.on('end', () => resolve(res.statusCode));
        },
      );
      req.on('error', reject);
      req.end();
    });
    assert.equal(status, 405);
  } finally {
    server.close();
  }
});

test('POST /api/jobs 接受 fetch-audio 与 lyrics 两个新 kind,非法字段仍走 400', async () => {
  const root = makeTempRoot();
  const {server, token} = createTestGalleryServer(root, {spawnImpl: makeFakeChild, runImpl: missingYtDlpRun});
  const port = await listen(server);
  try {
    const bad = await postJson(
      port,
      '/api/jobs',
      {kind: 'fetch-audio', folder: root, options: {id: '../etc/passwd', title: 'x'}},
      {'X-Kiseki-Token': token},
    );
    assert.equal(bad.status, 400);
    assert.equal(bad.body.field, 'id');

    const ok = await postJson(port, '/api/jobs', {kind: 'lyrics', folder: root}, {'X-Kiseki-Token': token});
    assert.equal(ok.status, 201);
  } finally {
    server.close();
  }
});

test('GET /api/fetch/* 也要 token:这两条会 spawn 外部进程', async () => {
  // Host 校验只挡 DNS rebinding,挡不住任意网页直接请求 localhost —— 不加这道闸,
  // 一个恶意页面循环请求就能无限起 yt-dlp 把机器拖垮(响应因 CORS 读不到,
  // 但进程和文件描述符是实打实被耗掉的).
  const root = makeTempRoot();
  const {server} = createTestGalleryServer(root, {spawnImpl: makeFakeChild, runImpl: missingYtDlpRun});
  const port = await listen(server);
  try {
    assert.equal((await getJson(port, '/api/fetch/audio-search?q=song')).status, 403);
    assert.equal((await getJson(port, '/api/fetch/audio-search?q=song', 'wrong')).status, 403);
    assert.equal((await getJson(port, `/api/fetch/lyrics-search?folder=${encodeURIComponent(root)}`)).status, 403);
  } finally {
    server.close();
  }
});
