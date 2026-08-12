import assert from 'node:assert/strict';
import test from 'node:test';

import {formatCommand, formatEquivalentCommand} from './command-format.mjs';

test('formatEquivalentCommand quotes arguments containing spaces', () => {
  assert.equal(
    formatEquivalentCommand(['still', './p', '--exif']),
    'node cli/kiseki.mjs still ./p --exif',
  );
  assert.equal(
    formatEquivalentCommand(['still', './p', '--exif', '--sign', '--dark']),
    'node cli/kiseki.mjs still ./p --exif --sign --dark',
  );
  assert.equal(
    formatEquivalentCommand(['still', '/Users/me/My Photos']),
    "node cli/kiseki.mjs still '/Users/me/My Photos'",
  );
});

test('formatCommand: 含 $、反引号、反斜杠的路径必须用单引号包裹', () => {
  assert.equal(formatCommand(['a$b']), "node cli/kiseki.mjs 'a$b'");
  assert.equal(formatCommand(['a`b']), "node cli/kiseki.mjs 'a`b'");
  assert.equal(formatCommand(['a\\b']), "node cli/kiseki.mjs 'a\\b'");
});

test('formatCommand: 含单引号的路径用转义', () => {
  assert.equal(formatCommand([`it's`]), `node cli/kiseki.mjs 'it'\\''s'`);
});

test('formatCommand: 自定义 program', () => {
  assert.equal(formatCommand(['/f'], {program: 'kiseki'}), 'kiseki /f');
});

test('formatCommand: env 前缀渲染,空 env 不留多余空格', () => {
  assert.equal(
    formatCommand(['/f', '--draft'], {program: 'kiseki', env: {KISEKI_CONCURRENCY: '25%'}}),
    'KISEKI_CONCURRENCY=25% kiseki /f --draft',
  );
  assert.equal(formatCommand(['/f'], {program: 'kiseki', env: {}}), 'kiseki /f');
});

test('formatCommand: 空串走引号分支', () => {
  assert.equal(formatCommand(['']), "node cli/kiseki.mjs ''");
});
