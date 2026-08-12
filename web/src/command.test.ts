/**
 * equivalentCommand 必须和服务端实际执行的 argv 同源;这里直接对拍
 * cli/job-argv.mjs + cli/command-format.mjs 的输出,而不是手工切字符串。
 *
 * 跑法与 capabilities.test.ts 一致:node --experimental-strip-types --test src/command.test.ts
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {equivalentCommand} from './command.ts';
import {buildJobArgv, buildJobEnv} from '../../cli/job-argv.mjs';
import {formatCommand} from '../../cli/command-format.mjs';

test('render: 默认选项保留 balanced 诊断环境变量', () => {
  const options = {
    exif: false,
    sign: false,
    dark: false,
    format: 'landscape',
    filter: null,
    filterIntensity: null,
    draft: false,
    trim: null,
    speed: 'balanced',
  };
  assert.equal(equivalentCommand('render', '/f', options), 'KISEKI_RENDER_SPEED=balanced kiseki /f');
});

test('render: 全部选项开启,精确匹配整串(含 env 前缀)', () => {
  const options = {
    exif: true,
    sign: true,
    dark: true,
    format: 'square',
    filter: 'faded',
    filterIntensity: 0.42,
    draft: true,
    trim: 'auto',
    speed: 'full',
  };
  assert.equal(
    equivalentCommand('render', '/f', options),
    'KISEKI_RENDER_SPEED=full KISEKI_CONCURRENCY=90% kiseki /f --exif --sign --dark --square --filter faded --filter-intensity 0.42 --draft --trim auto',
  );
});

test('still: 默认 scale(2 或不传)不带 --scale', () => {
  assert.equal(equivalentCommand('still', '/f', {}), 'KISEKI_RENDER_SPEED=balanced kiseki still /f');
  assert.equal(equivalentCommand('still', '/f', {scale: 2}), 'KISEKI_RENDER_SPEED=balanced kiseki still /f');
});

test('still: scale=4 带上 --scale 4', () => {
  assert.equal(equivalentCommand('still', '/f', {scale: 4}), 'KISEKI_RENDER_SPEED=balanced kiseki still /f --scale 4');
});

test('speed: balanced 保留诊断环境变量但不覆盖默认并发', () => {
  assert.equal(equivalentCommand('render', '/f', {speed: 'balanced'}), 'KISEKI_RENDER_SPEED=balanced kiseki /f');
});

test('folder 含空格与单引号,正确用单引号包裹并转义', () => {
  const folder = `/Users/me/My 'trip'`;
  assert.equal(
    equivalentCommand('render', folder, {}),
    `KISEKI_RENDER_SPEED=balanced kiseki '/Users/me/My '\\''trip'\\'''`,
  );
});

test('同源断言:equivalentCommand 与直接调用 buildJobArgv + buildJobEnv + formatCommand 结果一致', () => {
  const cases: Array<[('render' | 'still'), string, Record<string, unknown>]> = [
    ['render', '/f', {}],
    ['render', '/f', {exif: true, format: 'portrait', speed: 'saver'}],
    ['still', '/f', {scale: 3, filter: 'mono', filterIntensity: 0.2}],
    ['still', '/Users/me/My Photos', {}],
  ];
  for (const [kind, folder, options] of cases) {
    const expected = formatCommand(buildJobArgv({kind, folder, options}), {
      program: 'kiseki',
      env: buildJobEnv(options),
    });
    assert.equal(equivalentCommand(kind, folder, options), expected, JSON.stringify({kind, folder, options}));
  }
});
