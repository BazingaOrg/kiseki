import assert from 'node:assert/strict';
import test from 'node:test';

import {getDoctor} from './doctor.mjs';

test('returns every check with a stable shape', () => {
  const result = getDoctor();
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

test('node is always a required check and passes on a supported runtime', () => {
  const node = getDoctor().body.checks.find((check) => check.id === 'node');
  assert.equal(node.optional, false);
  // 测试本身就跑在 node 18+ 上,这项必然通过
  assert.equal(node.ok, true);
});

test('optional checks never make the overall status fail', () => {
  const {ok, checks} = getDoctor().body;
  const requiredAllOk = checks.filter((check) => !check.optional).every((check) => check.ok);
  assert.equal(ok, requiredAllOk);
});

test('a missing required dependency reports a fix hint', () => {
  const missing = getDoctor().body.checks.filter((check) => !check.optional && !check.ok);
  for (const check of missing) {
    assert.equal(typeof check.fix, 'string');
    assert.ok(check.fix.length > 0);
  }
});
