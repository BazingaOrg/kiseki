/**
 * kiseki doctor — <2s 依赖预检,不联网、不触发 `uv sync`(那可能很慢).
 */

import {spawn, spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import {term} from './term.mjs';
import {FIXES} from './dependencies.mjs';
import {sourceRuntimeLayout} from './runtime-layout.mjs';

export {FIXES} from './dependencies.mjs';

/**
 * 探测子命令的超时.doctor 承诺 <2s 完成,而这些 spawnSync 会阻塞整个进程 ——
 * web server 上 /api/doctor 也走这条路,PATH 上有个卡死的 yt-dlp 包装脚本
 * 就能把整个 server 挂住,不只是那一个请求.
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

const failedCommandCheck = (label, fix, optional = false) => ({
  id: label,
  ok: false,
  ...(optional ? {optional: true} : {}),
  line: optional ? 'yt-dlp 未安装(可选,仅在 fetch 下载音频时需要)' : `${label} 未找到`,
  fix,
});

/**
 * Web 端的子进程检查.CLI 必须继续使用上方 spawnSync 以保持既有输出与返回
 * 时机;HTTP 请求则不能让一个卡住的 PATH 包装脚本阻塞整个 Node 事件循环.
 */
const commandCheckAsync = (label, cmd, args, {versionRegex, fix, optional = false}, {
  spawnImpl = spawn,
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout,
  timeoutMs = PROBE_TIMEOUT_MS,
} = {}) => new Promise((resolve) => {
  let child;
  let settled = false;
  let stdout = '';
  let stderr = '';
  let timer;

  const finish = (result) => {
    if (settled) return;
    settled = true;
    clearTimeoutImpl(timer);
    resolve(result);
  };
  const fail = () => finish(failedCommandCheck(label, fix, optional));
  const succeed = () => {
    const text = `${stdout}${stderr}`;
    const match = versionRegex.exec(text);
    const version = match ? match[1] : text.trim().split('\n')[0];
    finish({id: label, ok: true, ...(optional ? {optional: true} : {}), line: optional ? `yt-dlp v${version}` : `${label} ${version}`});
  };

  try {
    child = spawnImpl(cmd, args, {stdio: ['ignore', 'pipe', 'pipe']});
    child.stdout?.on('data', (chunk) => { stdout += chunk; });
    child.stderr?.on('data', (chunk) => { stderr += chunk; });
    child.once('error', fail);
    child.once('close', (code) => {
      if (code === 0) succeed();
      else fail();
    });
    timer = setTimeoutImpl(() => {
      try {
        child.kill();
      } catch {
        // 进程已经自行结束时 kill 可能抛错;检查仍按失败返回.
      }
      fail();
    }, timeoutMs);
  } catch {
    fail();
  }
});

const uvCheck = (runtime) => {
  const found = commandCheck('uv', runtime.uv, ['--version'], {
    versionRegex: /uv (\S+)/,
    fix: FIXES.uv,
  });
  if (found.ok || !runtime.bundledAnalyzer) return found;
  return {id: 'uv', ok: true, line: 'uv 会随分析组件一起下载'};
};

const ffmpegCheck = (runtime) => {
  const found = commandCheck('ffmpeg', runtime.ffmpeg, ['-version'], {
    versionRegex: /ffmpeg version (\S+)/,
    fix: FIXES.ffmpeg,
  });
  if (found.ok || !runtime.bundledAnalyzer) return found;
  return {...found, line: 'FFmpeg 还没下载', fix: '点「下载 FFmpeg」'};
};

const rendererCheck = (runtime) => {
  const dir = path.join(runtime.rendererRoot, 'node_modules', '@remotion', 'renderer');
  if (fs.existsSync(dir)) {
    return {id: 'renderer', ok: true, line: '渲染器依赖已安装'};
  }
  return {id: 'renderer', ok: false, line: '渲染器依赖未安装', fix: FIXES.renderer};
};

/** 可选依赖 yt-dlp:仅提示,从不判定失败(只有 fetch 下载音频用到,用户自装). */
const ytDlpCheck = (runtime) => {
  const r = spawnSync(runtime.ytDlp, ['--version'], {encoding: 'utf8', timeout: PROBE_TIMEOUT_MS});
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

const analyzerScript = (venv) => path.join(
  venv,
  process.platform === 'win32' ? 'Scripts' : 'bin',
  process.platform === 'win32' ? 'kiseki-plan.exe' : 'kiseki-plan',
);

/** 开发机上的分析环境由 uv 在首次运行时构建。安装包里的分析组件要点下载后才算就绪。 */
const analyzerEnvCheck = (runtime) => {
  const managed = runtime.analyzerOffline || runtime.bundledAnalyzer;
  const venv = managed ? runtime.analyzerEnvRoot : path.join(runtime.analyzerRoot, '.venv');
  const ready = runtime.bundledAnalyzer ? fs.existsSync(analyzerScript(venv)) : fs.existsSync(venv);
  if (ready) {
    return runtime.bundledAnalyzer
      ? {id: 'analyzer', ok: true, line: '分析组件已就绪'}
      : {id: 'analyzer', ok: true, optional: true, line: 'analyzer 环境已就绪'};
  }
  if (runtime.bundledAnalyzer) {
    return {id: 'analyzer', ok: false, line: '分析组件还没下载', fix: '点「下载分析组件」'};
  }
  return {id: 'analyzer', ok: false, optional: true, line: 'analyzer 环境将在首次运行时由 uv 自动构建'};
};

/**
 * 只做检查、不打印,供 CLI(runDoctor)与 web API(/api/doctor)共用同一份判定.
 * 必需依赖缺失即 doctor 失败;`optional: true` 的项从不判定失败,只做提示.
 * @returns {{id: string, ok: boolean, line: string, fix?: string, optional?: boolean}[]}
 */
export const collectDoctorChecks = ({runtime = sourceRuntimeLayout} = {}) => [
  nodeCheck(),
  uvCheck(runtime),
  ffmpegCheck(runtime),
  rendererCheck(runtime),
  ytDlpCheck(runtime),
  analyzerEnvCheck(runtime),
];

/**
 * Web 专用的异步探测.同步的 node / 文件系统检查保留原判定,三个外部命令并行
 * 运行,并在返回前按 CLI 的稳定顺序重新组装.
 */
export const collectWebDoctorChecks = async ({runtime = sourceRuntimeLayout, ...processOptions} = {}) => {
  const [uvFound, ffmpegFound, ytDlp] = await Promise.all([
    commandCheckAsync('uv', runtime.uv, ['--version'], {versionRegex: /uv (\S+)/, fix: FIXES.uv}, processOptions),
    commandCheckAsync('ffmpeg', runtime.ffmpeg, ['-version'], {versionRegex: /ffmpeg version (\S+)/, fix: FIXES.ffmpeg}, processOptions),
    commandCheckAsync(
      'yt-dlp',
      runtime.ytDlp,
      ['--version'],
      {versionRegex: /(.+)/, fix: FIXES['yt-dlp'], optional: true},
      processOptions,
    ),
  ]);
  const uv = uvFound.ok || !runtime.bundledAnalyzer ? uvFound : {id: 'uv', ok: true, line: 'uv 会随分析组件一起下载'};
  const ffmpeg = ffmpegFound.ok || !runtime.bundledAnalyzer ? ffmpegFound : {...ffmpegFound, line: 'FFmpeg 还没下载', fix: '点「下载 FFmpeg」'};
  return [nodeCheck(), uv, ffmpeg, rendererCheck(runtime), ytDlp, analyzerEnvCheck(runtime)];
};

/**
 * @param {{repo?: string, checks?: ReturnType<typeof collectDoctorChecks>}} [options]
 *   `checks` 可注入,让测试能覆盖"必需项失败""可选项失败"这些在开发机上永远
 *   走不到的分支 —— 否则这些分支只有在别人的机器坏掉时才第一次被执行.
 */
export const runDoctor = ({runtime = sourceRuntimeLayout, checks = collectDoctorChecks({runtime})} = {}) => {
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
