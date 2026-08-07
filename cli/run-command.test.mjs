import assert from 'node:assert/strict';
import test from 'node:test';

import {runCommand} from './run-command.mjs';

test('missing command is translated without leaking spawn ENOENT', () => {
  const error = Object.assign(new Error('spawnSync uv ENOENT'), {code: 'ENOENT'});
  assert.equal(runCommand('分析音频', 'uv', [], {}, () => ({error})), 1);
});

test('stage command preserves a non-zero exit code', () => {
  assert.equal(runCommand('渲染视频', 'node', [], {}, () => ({status: 7})), 7);
});

// --- fd 3 的结构化进度出口 -------------------------------------------------

/** 抓住传给 spawn 的 options,断言 stdio 形状. */
const captureStdio = (env) => {
  let seen = null;
  runCommand('渲染视频', 'node', [], {}, (_cmd, _args, options) => {
    seen = options.stdio;
    return {status: 0};
  }, env);
  return seen;
};

test('fd 3 is passed down to the grandchild when the JSON progress flag is on', () => {
  // 渲染的百分比全部产生在 render.mjs 这个孙进程里(它一次 term.* 都不调),
  // 'inherit' 只继承 0/1/2,不显式带上 3 的话网页进度条永远是不确定态.
  assert.deepEqual(captureStdio({TSUZURI_JSON_PROGRESS: '1'}), ['inherit', 'inherit', 'inherit', 3]);
});

test('stdio stays plain inherit when the flag is off', () => {
  assert.equal(captureStdio({}), 'inherit');
  assert.equal(captureStdio({TSUZURI_JSON_PROGRESS: '0'}), 'inherit');
});

test('an explicit stdio option still wins over the default', () => {
  let seen = null;
  runCommand('分析音频', 'uv', [], {stdio: 'pipe'}, (_cmd, _args, options) => {
    seen = options.stdio;
    return {status: 0};
  }, {TSUZURI_JSON_PROGRESS: '1'});
  assert.equal(seen, 'pipe');
});
