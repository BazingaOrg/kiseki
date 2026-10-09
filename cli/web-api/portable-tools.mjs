import {spawn} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import zlib from 'node:zlib';

import {findBundledPython, packagedToolsRoot, relocateVirtualenv} from '../desktop-runtime.mjs';
import {sourceRuntimeLayout} from '../runtime-layout.mjs';

const UV_VERSION = '0.12.13';
const FFMPEG_TAG = 'n8.1.2-1';
const FFMPEG_MIRROR = 'https://cdn.npmmirror.com/binaries/ffmpeg-static/b6.1.1';
const UV_PYTHON_INSTALL_MIRROR = 'https://registry.npmmirror.com/-/binary/python-build-standalone';
const UV_DEFAULT_INDEX = 'https://pypi.tuna.tsinghua.edu.cn/simple';

const uvTarget = (platform, arch) => {
  const targets = {
    'darwin-arm64': 'uv-aarch64-apple-darwin.tar.gz',
    'darwin-x64': 'uv-x86_64-apple-darwin.tar.gz',
    'win32-x64': 'uv-x86_64-pc-windows-msvc.zip',
    'win32-arm64': 'uv-aarch64-pc-windows-msvc.zip',
    'linux-x64': 'uv-x86_64-unknown-linux-gnu.tar.gz',
    'linux-arm64': 'uv-aarch64-unknown-linux-gnu.tar.gz',
  };
  return targets[`${platform}-${arch}`] ?? null;
};

const ffmpegMirrorAssets = (platform, arch) => {
  const assets = {
    'darwin-arm64': ['ffmpeg-darwin-arm64.gz', 'ffprobe-darwin-arm64.gz'],
    'darwin-x64': ['ffmpeg-darwin-x64.gz', 'ffprobe-darwin-x64.gz'],
    'win32-x64': ['ffmpeg-win32-x64.gz', 'ffprobe-win32-x64.gz'],
    'linux-x64': ['ffmpeg-linux-x64.gz', 'ffprobe-linux-x64.gz'],
    'linux-arm64': ['ffmpeg-linux-arm64.gz', 'ffprobe-linux-arm64.gz'],
  };
  return assets[`${platform}-${arch}`] ?? null;
};

const ffmpegOfficialAssets = (platform, arch) => {
  const assets = {
    'darwin-arm64': ['ffmpeg-osx-arm64', 'ffprobe-osx-arm64'],
    'darwin-x64': ['ffmpeg-osx-x64', 'ffprobe-osx-x64'],
    'win32-x64': ['ffmpeg-win-x64.exe', 'ffprobe-win-x64.exe'],
  };
  return assets[`${platform}-${arch}`] ?? null;
};

export const portableUvUrls = (platform = process.platform, arch = process.arch) => {
  const name = uvTarget(platform, arch);
  if (!name) return [];
  return [
    `https://cnb.cool/astral-sh/uv/-/releases/download/${UV_VERSION}/${name}`,
    `https://releases.astral.sh/github/uv/releases/download/${UV_VERSION}/${name}`,
  ];
};

export const portableUvUrl = (platform = process.platform, arch = process.arch) => portableUvUrls(platform, arch)[0] ?? null;

export const portableFfmpegUrls = (platform = process.platform, arch = process.arch) => {
  const mirror = ffmpegMirrorAssets(platform, arch);
  if (!mirror) return null;
  const official = ffmpegOfficialAssets(platform, arch);
  const officialBase = `https://github.com/shaka-project/static-ffmpeg-binaries/releases/download/${FFMPEG_TAG}`;
  const pair = (index) => [
    `${FFMPEG_MIRROR}/${mirror[index]}`,
    ...(official ? [`${officialBase}/${official[index]}`] : []),
  ];
  return {ffmpeg: pair(0), ffprobe: pair(1)};
};

const executableName = (name, platform) => (platform === 'win32' ? `${name}.exe` : name);

const runChild = (spawnImpl, command, args, {env = process.env, timeoutMs = 180000} = {}) => new Promise((resolve) => {
  let settled = false;
  let output = '';
  let timer;
  const finish = (code) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    resolve({code, output: output.trim()});
  };
  let child;
  try {
    child = spawnImpl(command, args, {env, stdio: ['ignore', 'pipe', 'pipe']});
  } catch (error) {
    resolve({code: 1, output: error instanceof Error ? error.message : '无法启动。'});
    return;
  }
  const append = (chunk) => {
    output = `${output}${chunk}`.slice(-4000);
  };
  child.stdout?.on('data', append);
  child.stderr?.on('data', append);
  child.once('error', () => finish(1));
  child.once('close', (code) => finish(code ?? 1));
  timer = setTimeout(() => {
    try { child.kill(); } catch { /* 已经退出 */ }
    finish(1);
  }, timeoutMs);
});

const writeDownload = async (url, destination, fetchImpl) => {
  const response = await fetchImpl(url, {redirect: 'follow', headers: {'user-agent': 'kiseki'}});
  if (!response?.ok) {
    const status = response?.status ? `（${response.status}）` : '';
    throw new Error(`下载没有完成${status}`);
  }
  await fs.promises.mkdir(path.dirname(destination), {recursive: true});
  const temp = `${destination}.part`;
  try {
    if (Buffer.isBuffer(response.body)) {
      await fs.promises.writeFile(temp, response.body);
    } else if (response.body) {
      const stream = typeof response.body.getReader === 'function' ? Readable.fromWeb(response.body) : response.body;
      await pipeline(stream, fs.createWriteStream(temp));
    } else {
      throw new Error('下载内容是空的');
    }
    await fs.promises.rename(temp, destination);
  } catch (error) {
    await fs.promises.rm(temp, {force: true});
    throw error;
  }
};

const defaultExtract = async (archive, dest, spawnImpl) => {
  await fs.promises.mkdir(dest, {recursive: true});
  const result = await runChild(spawnImpl, 'tar', ['-xf', archive, '-C', dest], {timeoutMs: 120000});
  if (result.code !== 0) throw new Error(result.output || '没能解压下载的文件。');
};

const findFile = (dir, names) => {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) {
      const nested = findFile(full, names);
      if (nested) return nested;
    } else if (names.includes(name)) return full;
  }
  return null;
};

const placeExecutable = async (source, destination, platform) => {
  await fs.promises.mkdir(path.dirname(destination), {recursive: true});
  await fs.promises.rm(destination, {force: true});
  await fs.promises.copyFile(source, destination);
  if (platform !== 'win32') await fs.promises.chmod(destination, 0o755);
};

const assertVersion = async (spawnImpl, command, args, pattern) => {
  const result = await runChild(spawnImpl, command, args, {timeoutMs: 20000});
  if (result.code !== 0 || !pattern.test(result.output)) {
    throw new Error(result.output || '下载的文件无法运行。');
  }
};

export const materializeAnalyzerProject = (analyzerRoot, dest) => {
  fs.rmSync(dest, {recursive: true, force: true});
  fs.cpSync(analyzerRoot, dest, {
    recursive: true,
    filter: (source) => {
      const relative = path.relative(analyzerRoot, source);
      if (!relative) return true;
      const top = relative.split(path.sep)[0];
      return !['.venv', 'tests', '__pycache__', '.remotion', '.pytest_cache', '.ruff_cache', 'uv.lock'].includes(top);
    },
  });
  const projectFile = path.join(dest, 'pyproject.toml');
  const lines = fs.readFileSync(projectFile, 'utf8').split(/\r?\n/).filter((line) => !line.includes('mlx-whisper'));
  fs.writeFileSync(projectFile, `${lines.join('\n').replace(/\n+$/, '')}\n`);
  return dest;
};

const isGzip = async (file) => {
  const handle = await fs.promises.open(file, 'r');
  try {
    const header = Buffer.alloc(2);
    const {bytesRead} = await handle.read(header, 0, 2, 0);
    return bytesRead >= 2 && header[0] === 0x1f && header[1] === 0x8b;
  } finally {
    await handle.close();
  }
};

const inflateIfGzip = async (file) => {
  if (!(await isGzip(file))) return;
  const gz = `${file}.gz`;
  await fs.promises.rename(file, gz);
  await pipeline(fs.createReadStream(gz), zlib.createGunzip(), fs.createWriteStream(file));
  await fs.promises.rm(gz, {force: true});
};

const downloadFirst = async (urls, destination, fetchImpl) => {
  let lastError = null;
  for (const url of urls) {
    try {
      await writeDownload(url, destination, fetchImpl);
      await inflateIfGzip(destination);
      return;
    } catch (error) {
      lastError = error;
      await fs.promises.rm(destination, {force: true});
      await fs.promises.rm(`${destination}.gz`, {force: true});
    }
  }
  throw lastError ?? new Error('下载没有完成');
};

const installUv = async ({toolsRoot, platform, arch, fetchImpl, extractImpl, spawnImpl}) => {
  const destination = path.join(toolsRoot, 'bin', executableName('uv', platform));
  if (fs.existsSync(destination)) {
    try {
      await assertVersion(spawnImpl, destination, ['--version'], /uv /);
      return destination;
    } catch {
      await fs.promises.rm(destination, {force: true});
    }
  }
  const urls = portableUvUrls(platform, arch);
  if (urls.length === 0) throw new Error('这个系统还不能从页面下载 uv。');
  let installed = false;
  let lastError = null;
  for (const url of urls) {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'kiseki-uv-'));
    try {
      const archive = path.join(work, path.basename(url));
      await writeDownload(url, archive, fetchImpl);
      const extracted = path.join(work, 'extract');
      await extractImpl(archive, extracted, spawnImpl);
      const binary = findFile(extracted, [executableName('uv', platform), 'uv']);
      if (!binary) throw new Error('下载的 uv 里没有可执行文件。');
      await placeExecutable(binary, destination, platform);
      installed = true;
      break;
    } catch (error) {
      lastError = error;
      await fs.promises.rm(destination, {force: true});
    } finally {
      fs.rmSync(work, {recursive: true, force: true});
    }
  }
  if (!installed) throw lastError ?? new Error('没能下载 uv。');
  await assertVersion(spawnImpl, destination, ['--version'], /uv /);
  return destination;
};

const installFfmpeg = async ({toolsRoot, platform, arch, fetchImpl, spawnImpl}) => {
  const urls = portableFfmpegUrls(platform, arch);
  if (!urls) throw new Error('这个系统还不能从页面下载 FFmpeg。');
  const bin = path.join(toolsRoot, 'bin');
  const ffmpeg = path.join(bin, executableName('ffmpeg', platform));
  const ffprobe = path.join(bin, executableName('ffprobe', platform));
  await downloadFirst(urls.ffmpeg, ffmpeg, fetchImpl);
  await downloadFirst(urls.ffprobe, ffprobe, fetchImpl);
  if (platform !== 'win32') {
    await fs.promises.chmod(ffmpeg, 0o755);
    await fs.promises.chmod(ffprobe, 0o755);
  }
  try {
    await assertVersion(spawnImpl, ffmpeg, ['-version'], /ffmpeg version/);
    await assertVersion(spawnImpl, ffprobe, ['-version'], /ffprobe version/);
  } catch (error) {
    await fs.promises.rm(ffmpeg, {force: true});
    await fs.promises.rm(ffprobe, {force: true});
    throw error;
  }
};

const installAnalyzer = async ({toolsRoot, platform, arch, analyzerRoot, fetchImpl, extractImpl, spawnImpl}) => {
  const uv = await installUv({toolsRoot, platform, arch, fetchImpl, extractImpl, spawnImpl});
  const pythonRoot = path.join(toolsRoot, 'python');
  const envRoot = path.join(toolsRoot, 'analyzer-env');
  const cache = path.join(toolsRoot, 'uv-cache');
  await fs.promises.mkdir(pythonRoot, {recursive: true});
  const env = {
    ...process.env,
    UV_PYTHON_INSTALL_DIR: pythonRoot,
    UV_PYTHON_INSTALL_MIRROR,
    UV_DEFAULT_INDEX,
    UV_PROJECT_ENVIRONMENT: envRoot,
    UV_CACHE_DIR: cache,
  };
  let python = null;
  try { python = findBundledPython(pythonRoot); } catch { python = null; }
  if (!python) {
    const installed = await runChild(spawnImpl, uv, ['python', 'install', '3.12'], {env, timeoutMs: 600000});
    if (installed.code !== 0) throw new Error(installed.output || '没能下载 Python。');
    python = findBundledPython(pythonRoot);
  }
  const project = materializeAnalyzerProject(analyzerRoot, path.join(toolsRoot, 'analyzer-src'));
  const synced = await runChild(spawnImpl, uv, ['sync', '--project', project, '--no-dev', '--python', python], {env, timeoutMs: 1200000});
  if (synced.code !== 0) throw new Error(synced.output || '没能下载分析组件。');
  relocateVirtualenv(python, envRoot);
};

export const installPortableTool = async ({
  tool,
  platform = process.platform,
  arch = process.arch,
  toolsRoot = packagedToolsRoot(),
  analyzerRoot = sourceRuntimeLayout.analyzerRoot,
  fetchImpl = globalThis.fetch,
  extractImpl = defaultExtract,
  spawnImpl = spawn,
} = {}) => {
  try {
    if (tool === 'ffmpeg') await installFfmpeg({toolsRoot, platform, arch, fetchImpl, spawnImpl});
    else if (tool === 'uv' || tool === 'analyzer') {
      if (tool === 'uv') await installUv({toolsRoot, platform, arch, fetchImpl, extractImpl, spawnImpl});
      else await installAnalyzer({toolsRoot, platform, arch, analyzerRoot, fetchImpl, extractImpl, spawnImpl});
    } else {
      return {status: 400, body: {error: '这个环境还不能从页面下载。'}};
    }
    return {status: 200, body: {ok: true, tool}};
  } catch (error) {
    const message = error instanceof Error ? error.message : '下载没有完成。';
    return {status: 500, body: {error: message || '下载没有完成。'}};
  }
};
