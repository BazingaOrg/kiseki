import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {createRuntimeLayout} from './runtime-layout.mjs';

const binName = (name) => (process.platform === 'win32' ? `${name}.exe` : name);

const walkFiles = (root) => {
  const found = [];
  const visit = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) visit(full);
      else found.push(full);
    }
  };
  visit(root);
  return found;
};

export const packagedDataRoot = (env = process.env) => {
  if (env.KISEKI_DATA_ROOT) return path.resolve(env.KISEKI_DATA_ROOT);
  if (process.platform === 'win32') return path.join(env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'), 'kiseki');
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'kiseki');
  return path.join(os.homedir(), '.local', 'share', 'kiseki');
};

export const packagedToolsRoot = (env = process.env) => path.join(packagedDataRoot(env), 'tools');

export const findBundledPython = (pythonRoot) => {
  const preferred = walkFiles(pythonRoot).filter((file) => {
    const name = path.basename(file);
    return name === 'python3' || name === 'python.exe' || name === 'python';
  });
  const binary = preferred.find((file) => file.includes(`${path.sep}bin${path.sep}`) || file.includes(`${path.sep}Scripts${path.sep}`)) ?? preferred[0];
  if (!binary) throw new Error('还没有 Python。');
  return binary;
};

export const relocateVirtualenv = (python, envRoot) => {
  const configPath = path.join(envRoot, 'pyvenv.cfg');
  if (fs.existsSync(configPath)) {
    const home = `home = ${path.dirname(python)}`;
    const lines = fs.readFileSync(configPath, 'utf8').split(/\r?\n/).map((line) => (line.startsWith('home = ') ? home : line));
    fs.writeFileSync(configPath, `${lines.filter((line, index) => line !== '' || index !== lines.length - 1).join('\n')}\n`);
  }
  const scriptDir = path.join(envRoot, process.platform === 'win32' ? 'Scripts' : 'bin');
  if (!fs.existsSync(scriptDir)) return python;
  for (const name of fs.readdirSync(scriptDir)) {
    const file = path.join(scriptDir, name);
    if (!fs.statSync(file).isFile()) continue;
    const header = Buffer.alloc(2);
    const fd = fs.openSync(file, 'r');
    fs.readSync(fd, header, 0, 2, 0);
    fs.closeSync(fd);
    if (header.toString() !== '#!') continue;
    const body = fs.readFileSync(file, 'utf8');
    const newline = body.indexOf('\n');
    const rest = newline === -1 ? '\n' : body.slice(newline);
    fs.writeFileSync(file, `#!${python}${rest}`);
    fs.chmodSync(file, 0o755);
  }
  return python;
};

const installedPython = (pythonRoot) => {
  if (!fs.existsSync(pythonRoot)) return null;
  try {
    return findBundledPython(pythonRoot);
  } catch {
    return null;
  }
};

export const preparePackagedRuntime = (runtimeRoot, {dataRoot = packagedDataRoot()} = {}) => {
  const root = path.resolve(runtimeRoot);
  const tools = path.join(dataRoot, 'tools');
  const bin = path.join(tools, 'bin');
  const pythonRoot = path.join(tools, 'python');
  const envRoot = path.join(tools, 'analyzer-env');
  fs.mkdirSync(bin, {recursive: true});
  fs.mkdirSync(dataRoot, {recursive: true});
  const python = installedPython(pythonRoot);
  if (python && fs.existsSync(envRoot)) relocateVirtualenv(python, envRoot);
  const analyzerBin = path.join(envRoot, process.platform === 'win32' ? 'Scripts' : 'bin');
  const pathEntries = [bin, python ? path.dirname(python) : '', fs.existsSync(analyzerBin) ? analyzerBin : ''].filter(Boolean);
  process.env.PATH = [...pathEntries, process.env.PATH].filter(Boolean).join(path.delimiter);
  return createRuntimeLayout({
    sourceRoot: root,
    cliEntry: path.join(root, 'cli', 'kiseki.mjs'),
    webDist: path.join(root, 'web', 'dist'),
    analyzerRoot: path.join(root, 'analyzer'),
    rendererRoot: path.join(root, 'renderer'),
    ffmpeg: path.join(bin, binName('ffmpeg')),
    ffprobe: path.join(bin, binName('ffprobe')),
    uv: path.join(bin, binName('uv')),
    python: python ?? path.join(pythonRoot, process.platform === 'win32' ? 'python.exe' : 'python3'),
    analyzerEnvRoot: envRoot,
    bundledAnalyzer: true,
    cacheRoot: dataRoot,
    modelRoot: path.join(dataRoot, 'models'),
    tempRoot: os.tmpdir(),
  });
};

export const shouldOpenWebBrowser = (openBrowser, env = process.env) => openBrowser !== false && env.KISEKI_OPEN_BROWSER !== '0';
