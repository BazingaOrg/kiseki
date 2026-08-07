import assert from 'node:assert/strict';
import test from 'node:test';

import {createPercentProgress} from './progress.mjs';

const stream = (isTTY) => ({
  isTTY,
  output: '',
  write(chunk) {
    this.output += chunk;
  },
});

test('TTY 阶段切换与 label 变化均在同一行覆写,finish 恰好换一次行', () => {
  const run = (env) => {
    const stdout = stream(true);
    const progress = createPercentProgress({stream: stdout, env});
    progress.update('Rendering frames', 0.07);
    progress.update('Rendering frames', 0.42);
    progress.update('Encoding video', 1);
    progress.finish();
    return stdout.output;
  };

  const withoutFlag = run({});
  const flagOff = run({TSUZURI_JSON_PROGRESS: '0'});

  assert.equal(
    withoutFlag,
    '\r\x1b[2K└ Rendering frames   [█░░░░░░░░░░░░░░░░░░░]   7%' +
      '\r\x1b[2K└ Rendering frames   [████████░░░░░░░░░░░░]  42%' +
      '\r\x1b[2K└ Encoding video     [████████████████████] 100%\n',
  );
  assert.equal(flagOff, withoutFlag);
});

test('TSUZURI_JSON_PROGRESS=1 时 TTY 路径每次 percent 变化发一条 progress 事件', () => {
  const stdout = stream(true);
  const events = [];
  const progress = createPercentProgress({
    stream: stdout,
    env: {TSUZURI_JSON_PROGRESS: '1'},
    jsonWrite: (event) => events.push(event),
  });

  progress.update('Rendering frames', 0.07);
  progress.update('Rendering frames', 0.42);
  progress.update('Encoding video', 1);
  progress.finish();

  assert.deepEqual(events, [
    {kind: 'progress', label: 'Rendering frames', percent: 7},
    {kind: 'progress', label: 'Rendering frames', percent: 42},
    {kind: 'progress', label: 'Encoding video', percent: 100},
  ]);
  // finish() 不发事件;label/阶段变化不会额外换行.
  assert.equal(
    stdout.output,
    '\r\x1b[2K└ Rendering frames   [█░░░░░░░░░░░░░░░░░░░]   7%' +
      '\r\x1b[2K└ Rendering frames   [████████░░░░░░░░░░░░]  42%' +
      '\r\x1b[2K└ Encoding video     [████████████████████] 100%\n',
  );
});

test('非 TTY 路径下 JSON 事件不受终端的 25% 节流影响,逐个 percent 都发', () => {
  const stdout = stream(false);
  const events = [];
  const progress = createPercentProgress({
    stream: stdout,
    env: {TSUZURI_JSON_PROGRESS: '1'},
    jsonWrite: (event) => events.push(event),
  });

  for (const value of [0, 0.1, 0.24, 0.25, 0.51, 0.76, 1]) {
    progress.update('Rendering frames', value);
  }
  progress.finish();

  assert.deepEqual(
    events.map((event) => event.percent),
    [0, 10, 24, 25, 51, 76, 100],
  );
  // 终端侧仍按 25% 节流,证明 JSON 出口与终端节流互不影响.
  assert.equal(
    stdout.output,
    '└ Rendering frames   [░░░░░░░░░░░░░░░░░░░░]   0%\n' +
      '└ Rendering frames   [█████░░░░░░░░░░░░░░░]  25%\n' +
      '└ Rendering frames   [██████████░░░░░░░░░░]  51%\n' +
      '└ Rendering frames   [███████████████░░░░░]  76%\n' +
      '└ Rendering frames   [████████████████████] 100%\n',
  );
});

test('重复的 percent 跳过 JSON 事件,与终端"同 percent 不重复打印"一致', () => {
  const stdout = stream(true);
  const events = [];
  const progress = createPercentProgress({
    stream: stdout,
    env: {TSUZURI_JSON_PROGRESS: '1'},
    jsonWrite: (event) => events.push(event),
  });

  progress.update('Rendering frames', 0.5);
  progress.update('Rendering frames', 0.5);
  progress.update('Rendering frames', 0.5);

  assert.deepEqual(events, [{kind: 'progress', label: 'Rendering frames', percent: 50}]);
});

test('endLine 只结束活动行,后续阶段仍可继续且 finish 不重复换行', () => {
  const stdout = stream(true);
  const progress = createPercentProgress({stream: stdout});

  progress.update('Bundling code', 1);
  progress.endLine();
  progress.update('Rendering frames', 0);
  progress.finish();

  assert.equal(
    stdout.output,
    '\r\x1b[2K└ Bundling code      [████████████████████] 100%\n' +
      '\r\x1b[2K└ Rendering frames   [░░░░░░░░░░░░░░░░░░░░]   0%\n',
  );
});

test('非 TTY 以稳定 stage 节流,动态 label 不会重复输出阶段开始行', () => {
  const stdout = stream(false);
  const progress = createPercentProgress({stream: stdout});

  progress.update('Rendering still 1/3', 1 / 3, 'Rendering still');
  progress.update('Rendering still 2/3', 2 / 3, 'Rendering still');
  progress.update('Rendering still 3/3', 1, 'Rendering still');
  progress.finish();

  assert.equal(
    stdout.output,
    '└ Rendering still 1/3 [██████░░░░░░░░░░░░░░]  33%\n' +
      '└ Rendering still 2/3 [█████████████░░░░░░░]  67%\n' +
      '└ Rendering still 3/3 [████████████████████] 100%\n',
  );
});

test('开关开启但 fd 3 未打开时,默认 JSON 写入器吞掉 EBADF 且终端输出正常', () => {
  const stdout = stream(true);
  // 不注入 jsonWrite,走真实的 defaultJsonWrite → fs.writeSync(3, ...).
  const progress = createPercentProgress({stream: stdout, env: {TSUZURI_JSON_PROGRESS: '1'}});

  assert.doesNotThrow(() => {
    progress.update('Rendering frames', 0.07);
    progress.update('Rendering frames', 0.42);
    progress.finish();
  });

  assert.equal(
    stdout.output,
    '\r\x1b[2K└ Rendering frames   [█░░░░░░░░░░░░░░░░░░░]   7%' +
      '\r\x1b[2K└ Rendering frames   [████████░░░░░░░░░░░░]  42%\n',
  );
});
