import assert from 'node:assert/strict';
import test from 'node:test';

import {createDoctorService} from './doctor.mjs';

const CHECKS = [
  {id: 'node', ok: true, line: 'node v22 可用'},
  {id: 'uv', ok: true, line: 'uv 0.11'},
  {id: 'ffmpeg', ok: true, line: 'ffmpeg 8'},
  {id: 'renderer', ok: true, line: 'renderer 已安装'},
  {id: 'yt-dlp', ok: false, optional: true, line: 'yt-dlp 未安装', fix: '安装 yt-dlp'},
  {id: 'analyzer', ok: false, optional: true, line: 'analyzer 将构建'},
];

const serviceWith = (collect) => createDoctorService({collect, now: () => 1000});

test('returns every check with a stable shape', async () => {
  const result = await serviceWith(async () => CHECKS).getDoctor();
  assert.equal(result.status, 200);
  assert.deepEqual(
    result.body.checks.map((check) => check.id),
    ['node', 'uv', 'ffmpeg', 'renderer', 'yt-dlp', 'analyzer'],
  );
  for (const check of result.body.checks) {
    assert.equal(typeof check.ok, 'boolean');
    assert.equal(typeof check.optional, 'boolean');
    assert.equal(typeof check.line, 'string');
    // fix 必须显式为 null 而不是 undefined,否则 JSON.stringify 会整个丢掉这个键,
    // 前端就分不清"没有安装提示"和"字段拼错了"
    assert.ok(check.fix === null || typeof check.fix === 'string');
  }
});

test('node is always a required check and passes on a supported runtime', async () => {
  const node = (await serviceWith(async () => CHECKS).getDoctor()).body.checks.find((check) => check.id === 'node');
  assert.equal(node.optional, false);
  // 测试本身就跑在 node 18+ 上,这项必然通过
  assert.equal(node.ok, true);
});

test('optional checks never make the overall status fail', async () => {
  const {ok, checks} = (await serviceWith(async () => CHECKS).getDoctor()).body;
  const requiredAllOk = checks.filter((check) => !check.optional).every((check) => check.ok);
  assert.equal(ok, requiredAllOk);
});

test('a missing required dependency reports a fix hint', async () => {
  const missing = (await serviceWith(async () => [
    ...CHECKS.slice(0, 2),
    {id: 'ffmpeg', ok: false, line: 'ffmpeg 未找到', fix: '安装 ffmpeg'},
    ...CHECKS.slice(3),
  ]).getDoctor()).body.checks.filter((check) => !check.optional && !check.ok);
  for (const check of missing) {
    assert.equal(typeof check.fix, 'string');
    assert.ok(check.fix.length > 0);
  }
});

test('shares concurrent work, caches completed success for five seconds from completion, then expires', async () => {
  let now = 100;
  let calls = 0;
  let resolve;
  const service = createDoctorService({
    now: () => now,
    collect: () => {
      calls += 1;
      return new Promise((done) => { resolve = done; });
    },
  });
  const first = service.getDoctor();
  const sameFlight = service.getDoctor();
  assert.equal(calls, 0, 'collector begins on the shared promise microtask');
  await Promise.resolve();
  assert.equal(calls, 1);
  now = 200;
  resolve(CHECKS);
  assert.equal((await first).status, 200);
  assert.strictEqual(await sameFlight, await service.getDoctor());
  assert.equal(calls, 1);
  now = 5199;
  await service.getDoctor();
  assert.equal(calls, 1);
  now = 5200;
  const expired = service.getDoctor();
  await Promise.resolve();
  assert.equal(calls, 2);
  resolve(CHECKS);
  await expired;
});

test('refresh drops completed cache but joins an already running collection', async () => {
  let calls = 0;
  let resolve;
  const service = serviceWith(() => {
    calls += 1;
    return new Promise((done) => { resolve = done; });
  });
  const first = service.getDoctor();
  await Promise.resolve();
  resolve(CHECKS);
  await first;
  const refresh = service.getDoctor({refresh: true});
  const joiningRefresh = service.getDoctor({refresh: true});
  await Promise.resolve();
  assert.equal(calls, 2);
  resolve(CHECKS);
  assert.strictEqual(await refresh, await joiningRefresh);
});

test('a collector exception returns rejection and is not cached', async () => {
  let calls = 0;
  const service = serviceWith(async () => {
    calls += 1;
    throw new Error('unexpected');
  });
  await assert.rejects(service.getDoctor(), /unexpected/);
  await assert.rejects(service.getDoctor(), /unexpected/);
  assert.equal(calls, 2);
});

test('services keep their completed caches isolated', async () => {
  let firstCalls = 0;
  let secondCalls = 0;
  const first = serviceWith(async () => { firstCalls += 1; return CHECKS; });
  const second = serviceWith(async () => { secondCalls += 1; return CHECKS; });
  await Promise.all([first.getDoctor(), second.getDoctor(), first.getDoctor(), second.getDoctor()]);
  assert.equal(firstCalls, 1);
  assert.equal(secondCalls, 1);
});
