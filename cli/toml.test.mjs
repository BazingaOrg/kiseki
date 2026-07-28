import assert from 'node:assert/strict';
import test from 'node:test';

import {parseFlatToml} from './toml.mjs';

const captureError = (fn) => {
  try {
    fn();
  } catch (err) {
    return err;
  }
  throw new Error('expected function to throw');
};

test('accepts signed and underscored integers', () => {
  const {values} = parseFlatToml('a = 1_920\nb = -5\nc = +7\n');
  assert.equal(values.a, 1920);
  assert.equal(values.b, -5);
  assert.equal(values.c, 7);
});

test('accepts hex, octal, and binary integers', () => {
  const {values} = parseFlatToml('a = 0x1F\nb = 0o17\nc = 0b101\n');
  assert.equal(values.a, 31);
  assert.equal(values.b, 15);
  assert.equal(values.c, 5);
});

test('rejects signs on non-decimal integers to match TOML', () => {
  const err = captureError(() => parseFlatToml('a = -0x1\n'));
  assert.match(err.message, /无法识别的值 -0x1/);
});

test('accepts floats with exponents', () => {
  const {values} = parseFlatToml('a = 1.5e3\n');
  assert.equal(values.a, 1500);
});

test('accepts literal strings without escaping', () => {
  const {values} = parseFlatToml("a = 'no \\n escape'\n");
  assert.equal(values.a, 'no \\n escape');
});

test('accepts basic strings with escapes', () => {
  const {values} = parseFlatToml(String.raw`a = "line\nbreak \"quoted\" é"` + '\n');
  assert.equal(values.a, 'line\nbreak "quoted" é');
});

test('accepts a value followed by a comment', () => {
  const {values} = parseFlatToml('key = 1 # comment\n');
  assert.equal(values.key, 1);
});

test('preserves # inside a string value instead of treating it as a comment', () => {
  const {values} = parseFlatToml('outro_text = "a # b"\n');
  assert.equal(values.outro_text, 'a # b');
});

test('accepts CRLF line endings', () => {
  const {values} = parseFlatToml('a = 1\r\nb = 2\r\n');
  assert.equal(values.a, 1);
  assert.equal(values.b, 2);
});

test('accepts quoted keys', () => {
  const {values} = parseFlatToml('"basic key" = 1\n');
  assert.equal(values['basic key'], 1);
});

test('rejects [table] headers', () => {
  const err = captureError(() => parseFlatToml('[table]\na = 1\n'));
  assert.match(err.message, /不支持 \[table\] \/ 数组表/);
  assert.equal(err.line, 1);
});

test('rejects array values', () => {
  const err = captureError(() => parseFlatToml('x = [1,2]\n'));
  assert.match(err.message, /不支持数组 \/ 内联表/);
  assert.equal(err.line, 1);
});

test('rejects inline tables', () => {
  const err = captureError(() => parseFlatToml('x = {a=1}\n'));
  assert.match(err.message, /不支持数组 \/ 内联表/);
  assert.equal(err.line, 1);
});

test('rejects multiline strings', () => {
  const err = captureError(() => parseFlatToml('x = """\nabc\n"""\n'));
  assert.match(err.message, /不支持多行字符串/);
  assert.equal(err.line, 1);
});

test('rejects dotted keys', () => {
  const err = captureError(() => parseFlatToml('a.b = 1\n'));
  assert.match(err.message, /不支持点号键/);
  assert.equal(err.line, 1);
});

test('rejects duplicate keys', () => {
  const err = captureError(() => parseFlatToml('a = 1\na = 2\n'));
  assert.match(err.message, /重复配置项 a\(第 1 行已出现\)/);
  assert.equal(err.line, 2);
});

test('rejects a line missing =', () => {
  const err = captureError(() => parseFlatToml('a 1\n'));
  assert.equal(err.line, 1);
});

test('rejects unquoted bare word values', () => {
  const err = captureError(() => parseFlatToml('background = FFFFFF\n'));
  assert.match(err.message, /无法识别的值 FFFFFF/);
  assert.equal(err.line, 1);
});
