/**
 * doctor 的检查项已拆给 collectDoctorChecks 供 web API 复用,runDoctor 只剩打印。
 * 这组测试盯住"打印行为不因拆分而改变"——顺序、前缀、必需项与可选项的区别对待。
 *
 * 失败分支用注入的合成 checks 覆盖:在依赖齐全的开发机上,真实 checks 永远全绿,
 * 光靠它跑不到 term.error / term.info 那两条路,断言等于没写。
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {collectDoctorChecks, runDoctor} from './doctor.mjs';

/** 捕获 stdout/stderr,按写入顺序记录并标注来源流(term 同步写,顺序可靠)。 */
const captureOutput = (fn) => {
  const lines = [];
  const originalOut = process.stdout.write;
  const originalErr = process.stderr.write;
  const collect = (stream) => (chunk) => {
    for (const line of String(chunk).split('\n')) if (line.length > 0) lines.push({stream, line});
    return true;
  };
  process.stdout.write = collect('stdout');
  process.stderr.write = collect('stderr');
  try {
    const code = fn();
    return {code, lines, text: lines.map((entry) => entry.line)};
  } finally {
    process.stdout.write = originalOut;
    process.stderr.write = originalErr;
  }
};

test('prints one bullet line per check, in collectDoctorChecks order', () => {
  const checks = collectDoctorChecks();
  const {text} = captureOutput(() => runDoctor());
  const bullets = text.filter((line) => line.startsWith('● '));
  assert.deepEqual(bullets, checks.map((check) => `● ${check.line}`));
});

test('exit code reflects required checks only', () => {
  const checks = collectDoctorChecks();
  const requiredAllOk = checks.filter((check) => !check.optional).every((check) => check.ok);
  const {code} = captureOutput(() => runDoctor());
  assert.equal(code, requiredAllOk ? 0 : 1);
});

test('a failing required check goes to stderr with its fix on the next line', () => {
  const checks = [{id: 'ffmpeg', ok: false, line: 'ffmpeg 未找到', fix: 'brew install ffmpeg'}];
  const {code, lines} = captureOutput(() => runDoctor({checks}));
  assert.equal(code, 1);
  assert.deepEqual(lines, [
    {stream: 'stderr', line: '● ffmpeg 未找到'},
    {stream: 'stdout', line: '└ brew install ffmpeg'},
  ]);
});

test('a failing optional check goes to stdout and never fails the run', () => {
  const checks = [{id: 'yt-dlp', ok: false, optional: true, line: 'yt-dlp 未安装', fix: 'brew install yt-dlp'}];
  const {code, lines} = captureOutput(() => runDoctor({checks}));
  assert.equal(code, 0, '可选依赖缺失不该让 doctor 失败');
  assert.deepEqual(lines, [
    {stream: 'stdout', line: '● yt-dlp 未安装'},
    {stream: 'stdout', line: '└ brew install yt-dlp'},
  ]);
});

test('an optional check without a fix prints no detail line', () => {
  // analyzer 那一项就是这种:只提示,没有安装命令可给
  const checks = [{id: 'analyzer', ok: false, optional: true, line: 'analyzer 环境将在首次运行时由 uv 自动构建'}];
  const {code, lines} = captureOutput(() => runDoctor({checks}));
  assert.equal(code, 0);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].line, '● analyzer 环境将在首次运行时由 uv 自动构建');
});

test('a passing check prints a single stdout line with no detail', () => {
  const checks = [{id: 'node', ok: true, line: 'node v22.0.0 可用'}];
  const {code, lines} = captureOutput(() => runDoctor({checks}));
  assert.equal(code, 0);
  assert.deepEqual(lines, [{stream: 'stdout', line: '● node v22.0.0 可用'}]);
});

test('one required failure among passing checks still fails the run', () => {
  const checks = [
    {id: 'node', ok: true, line: 'node ok'},
    {id: 'uv', ok: false, line: 'uv 未找到', fix: '装 uv'},
    {id: 'yt-dlp', ok: false, optional: true, line: 'yt-dlp 未安装', fix: '装 yt-dlp'},
  ];
  const {code, text} = captureOutput(() => runDoctor({checks}));
  assert.equal(code, 1);
  // 顺序保持不变,失败项不会被挪到最后
  assert.deepEqual(text.filter((line) => line.startsWith('● ')), [
    '● node ok',
    '● uv 未找到',
    '● yt-dlp 未安装',
  ]);
});
