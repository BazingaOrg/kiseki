/**
 * tsuzuri doctor — <2s 依赖预检,不联网、不触发 `uv sync`(那可能很慢)。
 */

import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {term} from './term.mjs';
import {FIXES} from './dependencies.mjs';

export {FIXES} from './dependencies.mjs';

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/**
 * 探测子命令的超时。doctor 承诺 <2s 完成,而这些 spawnSync 会阻塞整个进程 ——
 * web server 上 /api/doctor 也走这条路,PATH 上有个卡死的 yt-dlp 包装脚本
 * 就能把整个 server 挂住,不只是那一个请求。
 */
const PROBE_TIMEOUT_MS = 2000;

const nodeCheck = () => {
  const major = Number(process.version.slice(1).split('.')[0]);
  if (Number.isFinite(major) && major >= 18) {
    return {id: 'node', ok: true, line: `node ${process.version} 可用`};
  }
  return {
    id: 'node',
    ok: false,
    line: `node 版本过低: ${process.version}(需要 >= 18)`,
    fix: '安装 Node 18+ (https://nodejs.org)',
  };
};

const commandCheck = (label, cmd, args, {versionRegex, fix}) => {
  const r = spawnSync(cmd, args, {encoding: 'utf8', timeout: PROBE_TIMEOUT_MS});
  if (r.error || r.status !== 0) {
    return {id: label, ok: false, line: `${label} 未找到`, fix};
  }
  const text = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  const match = versionRegex.exec(text);
  const version = match ? match[1] : text.trim().split('\n')[0];
  return {id: label, ok: true, line: `${label} ${version}`};
};

const uvCheck = () =>
  commandCheck('uv', 'uv', ['--version'], {
    versionRegex: /uv (\S+)/,
    fix: FIXES.uv,
  });

const ffmpegCheck = () =>
  commandCheck('ffmpeg', 'ffmpeg', ['-version'], {
    versionRegex: /ffmpeg version (\S+)/,
    fix: FIXES.ffmpeg,
  });

const rendererCheck = (repo) => {
  const dir = path.join(repo, 'renderer', 'node_modules', '@remotion', 'renderer');
  if (fs.existsSync(dir)) {
    return {id: 'renderer', ok: true, line: '渲染器依赖已安装'};
  }
  return {id: 'renderer', ok: false, line: '渲染器依赖未安装', fix: FIXES.renderer};
};

/** 可选依赖 yt-dlp:仅提示,从不判定失败(只有 fetch 下载音频用到,用户自装)。 */
const ytDlpCheck = () => {
  const r = spawnSync('yt-dlp', ['--version'], {encoding: 'utf8', timeout: PROBE_TIMEOUT_MS});
  if (!r.error && r.status === 0) {
    return {id: 'yt-dlp', ok: true, optional: true, line: `yt-dlp v${(r.stdout ?? '').trim()}`};
  }
  return {
    id: 'yt-dlp',
    ok: false,
    optional: true,
    line: 'yt-dlp 未安装(可选,仅在 fetch 下载音频时需要)',
    fix: FIXES['yt-dlp'],
  };
};

/** 分析器 Python 环境:仅提示,从不判定失败(uv 会在首次运行时自动构建)。 */
const analyzerEnvCheck = (repo) => {
  const venv = path.join(repo, 'analyzer', '.venv');
  if (fs.existsSync(venv)) {
    return {id: 'analyzer', ok: true, optional: true, line: 'analyzer 环境已就绪'};
  }
  return {id: 'analyzer', ok: false, optional: true, line: 'analyzer 环境将在首次运行时由 uv 自动构建'};
};

/**
 * 只做检查、不打印,供 CLI(runDoctor)与 web API(/api/doctor)共用同一份判定。
 * 必需依赖缺失即 doctor 失败;`optional: true` 的项从不判定失败,只做提示。
 * @returns {{id: string, ok: boolean, line: string, fix?: string, optional?: boolean}[]}
 */
export const collectDoctorChecks = ({repo = REPO} = {}) => [
  nodeCheck(),
  uvCheck(),
  ffmpegCheck(),
  rendererCheck(repo),
  ytDlpCheck(),
  analyzerEnvCheck(repo),
];

/**
 * @param {{repo?: string, checks?: ReturnType<typeof collectDoctorChecks>}} [options]
 *   `checks` 可注入,让测试能覆盖"必需项失败""可选项失败"这些在开发机上永远
 *   走不到的分支 —— 否则这些分支只有在别人的机器坏掉时才第一次被执行。
 */
export const runDoctor = ({repo = REPO, checks = collectDoctorChecks({repo})} = {}) => {
  let hasFailure = false;
  for (const check of checks) {
    if (check.ok) {
      term.success(check.line);
    } else if (check.optional) {
      term.info(check.line);
      if (check.fix) term.detail(check.fix);
    } else {
      hasFailure = true;
      term.error(check.line);
      term.detail(check.fix);
    }
  }

  return hasFailure ? 1 : 0;
};
