#!/usr/bin/env node
/**
 * 容错入口:在 renderer/ 目录下误跑 `node cli/kiseki.mjs` 时转发到仓库真正的 CLI。
 * (装依赖 / 开 Studio 后 cwd 常停在 renderer/,Node 会先找本路径再抛 MODULE_NOT_FOUND)
 */
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const realCli = path.resolve(here, '..', '..', 'cli', 'kiseki.mjs');

if (!fs.existsSync(realCli)) {
  console.error(
    'kiseki: 找不到 CLI 入口。\n' +
      `  期望: ${realCli}\n` +
      '  请在仓库根目录执行: node cli/kiseki.mjs <folder>\n' +
      '  (若你在 renderer/ 下,先 cd .. 回到含 cli/ 与 renderer/ 的根目录)',
  );
  process.exit(1);
}

const result = spawnSync(process.execPath, [realCli, ...process.argv.slice(2)], {
  stdio: 'inherit',
});
process.exit(result.status === null ? 1 : result.status);
