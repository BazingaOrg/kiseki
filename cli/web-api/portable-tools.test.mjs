import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import zlib from 'node:zlib';

const analyzerRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'analyzer');

import {installTool} from './setup-tools.mjs';
import {installPortableTool, materializeAnalyzerProject, portableFfmpegUrls, portableUvUrl} from './portable-tools.mjs';

const closeOk = (output = '') => {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => {};
  queueMicrotask(() => {
    child.stdout.emit('data', output);
    child.emit('close', 0);
  });
  return child;
};

test('portable downloads target the current desktop architectures', () => {
  assert.match(portableUvUrl('darwin', 'arm64'), /^https:\/\/cnb\.cool\/.*\/uv-aarch64-apple-darwin\.tar\.gz$/);
  assert.match(portableUvUrl('win32', 'x64'), /uv-x86_64-pc-windows-msvc\.zip$/);
  assert.match(portableFfmpegUrls('linux', 'x64').ffmpeg[0], /ffmpeg-linux-x64\.gz$/);
  assert.match(portableFfmpegUrls('darwin', 'arm64').ffprobe[0], /ffprobe-darwin-arm64\.gz$/);
  assert.match(portableFfmpegUrls('darwin', 'arm64').ffprobe[1], /ffprobe-osx-arm64$/);
  assert.match(portableFfmpegUrls('win32', 'x64').ffmpeg[0], /ffmpeg-win32-x64\.gz$/);
  assert.equal(portableFfmpegUrls('freebsd', 'x64'), null);
});

test('desktop ffmpeg download writes both tools into app data', async () => {
  const tools = fs.mkdtempSync(path.join(os.tmpdir(), 'kiseki-tools-'));
  const urls = [];
  const result = await installTool({
    tool: 'ffmpeg',
    portable: true,
    platform: 'darwin',
    arch: 'arm64',
    toolsRoot: tools,
    fetchImpl: async (url) => {
      urls.push(url);
      return {ok: true, status: 200, body: Buffer.from(url.includes('ffprobe') ? 'probe' : 'mpeg')};
    },
    spawnImpl: (command) => closeOk(String(command).endsWith('ffprobe') ? 'ffprobe version 8.1' : 'ffmpeg version 8.1'),
  });
  assert.equal(result.status, 200);
  assert.equal(urls.length, 2);
  assert.equal(fs.readFileSync(path.join(tools, 'bin', 'ffmpeg'), 'utf8'), 'mpeg');
  assert.equal(fs.readFileSync(path.join(tools, 'bin', 'ffprobe'), 'utf8'), 'probe');
  fs.rmSync(tools, {recursive: true, force: true});
});

test('a gzip ffmpeg download is unpacked before the version check', async () => {
  const tools = fs.mkdtempSync(path.join(os.tmpdir(), 'kiseki-tools-'));
  const result = await installTool({
    tool: 'ffmpeg',
    portable: true,
    platform: 'darwin',
    arch: 'arm64',
    toolsRoot: tools,
    fetchImpl: async (url) => ({
      ok: true,
      status: 200,
      body: zlib.gzipSync(Buffer.from(url.includes('ffprobe') ? 'probe' : 'mpeg')),
    }),
    spawnImpl: (command) => closeOk(String(command).endsWith('ffprobe') ? 'ffprobe version 6.0' : 'ffmpeg version 6.0'),
  });
  assert.equal(result.status, 200, result.body?.error);
  assert.equal(fs.readFileSync(path.join(tools, 'bin', 'ffmpeg'), 'utf8'), 'mpeg');
  assert.equal(fs.readFileSync(path.join(tools, 'bin', 'ffprobe'), 'utf8'), 'probe');
  fs.rmSync(tools, {recursive: true, force: true});
});

test('an unsupported desktop system does not pretend to download ffmpeg', async () => {
  let fetched = false;
  const result = await installTool({
    tool: 'ffmpeg',
    portable: true,
    platform: 'freebsd',
    arch: 'x64',
    fetchImpl: async () => { fetched = true; return {ok: true, body: Buffer.from('')}; },
  });
  assert.equal(result.status, 500);
  assert.match(result.body.error, /不能从页面下载 FFmpeg/);
  assert.equal(fetched, false);
});

test('analyzer download installs from a project copy without mlx', async () => {
  const tools = fs.mkdtempSync(path.join(os.tmpdir(), 'kiseki-tools-'));
  const steps = [];
  const result = await installPortableTool({
    tool: 'analyzer',
    platform: 'darwin',
    arch: 'arm64',
    toolsRoot: tools,
    analyzerRoot,
    fetchImpl: async () => ({ok: true, status: 200, body: Buffer.from('archive')}),
    extractImpl: async (_archive, dest) => {
      fs.mkdirSync(dest, {recursive: true});
      fs.writeFileSync(path.join(dest, 'uv'), 'uv');
    },
    spawnImpl: (command, args, options) => {
      steps.push(args[0]);
      if (args[0] === 'python' || args[0] === 'sync') {
        assert.equal(options.env.UV_DEFAULT_INDEX, 'https://pypi.tuna.tsinghua.edu.cn/simple');
        assert.equal(options.env.UV_PYTHON_INSTALL_MIRROR, 'https://registry.npmmirror.com/-/binary/python-build-standalone');
      }
      if (args[0] === 'python') {
        const dir = path.join(tools, 'python', 'cpython', 'bin');
        fs.mkdirSync(dir, {recursive: true});
        fs.writeFileSync(path.join(dir, 'python3'), 'python');
      }
      if (args[0] === 'sync') {
        const project = args[args.indexOf('--project') + 1];
        assert.equal(fs.readFileSync(path.join(project, 'pyproject.toml'), 'utf8').includes('mlx-whisper'), false);
        assert.equal(fs.existsSync(path.join(project, 'uv.lock')), false);
        const bin = path.join(tools, 'analyzer-env', 'bin');
        fs.mkdirSync(bin, {recursive: true});
        fs.writeFileSync(path.join(bin, 'kiseki-plan'), '#!/old/python\n');
      }
      return closeOk(args[0] === '--version' ? 'uv 0.12.13' : 'ok');
    },
  });
  assert.equal(result.status, 200, result.body?.error);
  assert.deepEqual(steps, ['--version', 'python', 'sync']);
  assert.match(fs.readFileSync(path.join(tools, 'analyzer-env', 'bin', 'kiseki-plan'), 'utf8'), /^#!.*python3\n/);
  fs.rmSync(tools, {recursive: true, force: true});
});

test('materializeAnalyzerProject removes the mlx dependency from the copied project', () => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'kiseki-analyzer-src-'));
  materializeAnalyzerProject(analyzerRoot, dest);
  const text = fs.readFileSync(path.join(dest, 'pyproject.toml'), 'utf8');
  assert.equal(text.includes('mlx-whisper'), false);
  assert.equal(text.includes('faster-whisper'), true);
  assert.equal(fs.existsSync(path.join(dest, 'uv.lock')), false);
  fs.rmSync(dest, {recursive: true, force: true});
});
