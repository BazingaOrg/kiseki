import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const prepareAnalyzerRuntime = (runtime, {spawn = spawnSync} = {}) => {
  const marker = path.join(runtime.analyzerEnvRoot, '.kiseki-complete');
  const fingerprint = crypto.createHash('sha256').update(fs.readFileSync(path.join(runtime.analyzerRoot, 'uv.lock'))).update(runtime.python).digest('hex');
  if (fs.existsSync(marker) && fs.readFileSync(marker, 'utf8').trim() === fingerprint) return;
  fs.rmSync(runtime.analyzerEnvRoot, {recursive: true, force: true});
  fs.mkdirSync(path.dirname(runtime.analyzerEnvRoot), {recursive: true, mode: 0o700});
  const env = {
    ...process.env,
    UV_PROJECT_ENVIRONMENT: runtime.analyzerEnvRoot,
    UV_FIND_LINKS: runtime.wheelhouseRoot,
    UV_NO_INDEX: '1',
    UV_PYTHON: runtime.python,
    UV_PYTHON_DOWNLOADS: 'never',
  };
  const result = spawn(runtime.uv, ['sync', '--offline', '--frozen', '--project', runtime.analyzerRoot], {encoding: 'utf8', env});
  if (result.error || result.status !== 0) {
    fs.rmSync(runtime.analyzerEnvRoot, {recursive: true, force: true});
    throw new Error(`Analyzer 运行时安装失败: ${(result.error?.message ?? result.stderr ?? '').trim()}`);
  }
  fs.writeFileSync(marker, `${fingerprint}\n`, {mode: 0o600});
};
