import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';

import {loadProjectConfig} from './config.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'examples', 'config-cases.json'), 'utf8'),
);

const makeProjectDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'kiseki-config-'));

const writeCase = (dir, testCase) => {
  fs.writeFileSync(path.join(dir, 'kiseki.toml'), testCase.toml, 'utf8');
  for (const file of testCase.files ?? []) {
    fs.writeFileSync(path.join(dir, file.name), file.content, 'utf8');
  }
};

for (const testCase of FIXTURE.cases) {
  test(`config-cases: ${testCase.name}`, () => {
    const dir = makeProjectDir();
    try {
      writeCase(dir, testCase);
      if (testCase.expect === 'ok') {
        const {values} = loadProjectConfig(dir);
        assert.deepEqual(values, testCase.config);
      } else {
        assert.throws(
          () => loadProjectConfig(dir),
          (err) => {
            assert.ok(err.message.includes(testCase.key), `期望错误信息包含 "${testCase.key}",实际: ${err.message}`);
            assert.ok(
              err.message.includes(`第 ${testCase.line} 行`),
              `期望错误信息包含 "第 ${testCase.line} 行",实际: ${err.message}`,
            );
            return true;
          },
        );
      }
    } finally {
      fs.rmSync(dir, {recursive: true, force: true});
    }
  });
}

test('missing kiseki.toml yields all defaults and no explicit keys', () => {
  const dir = makeProjectDir();
  try {
    const {values, explicitKeys} = loadProjectConfig(dir);
    assert.deepEqual(values, FIXTURE.defaults);
    assert.equal(explicitKeys.size, 0);
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
  }
});

test('explicitKeys reflects exactly the keys present in the file', () => {
  const dir = makeProjectDir();
  try {
    fs.writeFileSync(path.join(dir, 'kiseki.toml'), 'fps = 30\n', 'utf8');
    const {explicitKeys} = loadProjectConfig(dir);
    assert.deepEqual([...explicitKeys], ['fps']);
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
  }
});
