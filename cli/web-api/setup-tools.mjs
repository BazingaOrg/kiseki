import {spawn} from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

import {installPortableTool} from './portable-tools.mjs';

export const toolCommand = (tool, platform = process.platform) => {
  if (tool === 'uv' && platform === 'win32') {
    return {command: 'powershell.exe', args: ['-NoProfile', '-Command', 'irm https://astral.sh/uv/install.ps1 | iex']};
  }
  if (tool === 'uv') {
    return {command: 'bash', args: ['-lc', 'curl -LsSf https://astral.sh/uv/install.sh | sh']};
  }
  if (tool === 'ffmpeg' && platform === 'win32') {
    return {command: 'winget', args: ['install', '--id', 'Gyan.FFmpeg', '-e', '--accept-package-agreements', '--accept-source-agreements']};
  }
  if (tool === 'ffmpeg' && platform === 'darwin') {
    return {command: 'brew', args: ['install', 'ffmpeg']};
  }
  return null;
};

export const prependToolPaths = (env = process.env, {platform = process.platform, home = os.homedir()} = {}) => {
  const entries = platform === 'win32'
    ? [path.join(home, '.local', 'bin'), path.join(home, 'AppData', 'Roaming', 'uv'), path.join(home, 'AppData', 'Local', 'Microsoft', 'WinGet', 'Links')]
    : [path.join(home, '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin'];
  const current = String(env.PATH ?? '').split(path.delimiter).filter(Boolean);
  const missing = entries.filter((entry) => !current.includes(entry));
  if (missing.length > 0) env.PATH = [...missing, ...current].join(path.delimiter);
  return env;
};

let running = null;

export const installTool = ({
  tool,
  platform = process.platform,
  spawnImpl = spawn,
  timeoutMs = 180000,
  env = process.env,
  portable = env.KISEKI_DESKTOP === '1',
  ...portableOptions
} = {}) => {
  if (portable) {
    if (running) return Promise.resolve({status: 409, body: {error: '已有一项安装在进行，请等它结束。'}});
    running = tool ?? 'download';
    return installPortableTool({tool, platform, spawnImpl, env, ...portableOptions}).finally(() => {
      running = null;
    });
  }
  const spec = toolCommand(tool, platform);
  if (!spec) {
    return Promise.resolve({
      status: 400,
      body: {error: tool === 'ffmpeg' ? '当前系统请用自己的软件源安装 ffmpeg，装好后点重新检查。' : '这个环境还不能从页面安装。'},
    });
  }
  if (running) return Promise.resolve({status: 409, body: {error: '已有一项安装在进行，请等它结束。'}});
  running = tool;
  return new Promise((resolve) => {
    let output = '';
    let child;
    let timer;
    const finish = (result) => {
      clearTimeout(timer);
      running = null;
      resolve(result);
    };
    try {
      child = spawnImpl(spec.command, spec.args, {env, stdio: ['ignore', 'pipe', 'pipe']});
    } catch (error) {
      finish({status: 500, body: {error: error instanceof Error ? error.message : '无法启动安装。'}});
      return;
    }
    const append = (chunk) => {
      output = `${output}${chunk}`.slice(-4000);
    };
    child.stdout?.on('data', append);
    child.stderr?.on('data', append);
    child.once('error', (error) => finish({status: 500, body: {error: error.code === 'ENOENT' ? `没有找到 ${spec.command}。` : '安装没有启动。'}}));
    child.once('close', (code) => {
      prependToolPaths(env, {platform});
      if (code === 0) finish({status: 200, body: {ok: true, tool}});
      else finish({status: 500, body: {error: '安装没有完成。', detail: output.trim().slice(-500)}});
    });
    timer = setTimeout(() => {
      try { child.kill(); } catch { /* 已经退出 */ }
      finish({status: 500, body: {error: '安装超时。可以稍后点重新检查，或按提示手动安装。'}});
    }, timeoutMs);
  });
};
