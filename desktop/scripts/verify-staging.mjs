import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), 'staging', 'kiseki-runtime');
for (const required of ['cli/kiseki.mjs', 'web/dist/index.html', 'renderer/package.json', 'renderer/node_modules/@remotion/renderer/package.json', 'analyzer/pyproject.toml', 'analyzer/uv.lock', 'analyzer/wheelhouse', 'bin/ffmpeg', 'bin/ffprobe', 'bin/uv', 'chromium/bin/chrome-headless-shell', 'python/bin/python3', 'licenses', 'runtime-files.json']) {
  if (!fs.existsSync(path.join(root, required))) throw new Error(`staging 缺少 ${required}`);
}
for (const binary of ['ffmpeg', 'ffprobe', 'uv']) {
  const target = path.join(root, 'bin', binary);
  if ((fs.statSync(target).mode & 0o111) === 0) throw new Error(`${binary} 不可执行`);
}
for (const required of ['cli/node_modules/exifr/package.json', 'chromium/bin/chrome-headless-shell', 'python/bin/python3']) if (!fs.existsSync(path.join(root, required))) throw new Error(`staging 缺少 ${required}`);
if ((fs.statSync(path.join(root, 'chromium', 'bin', 'chrome-headless-shell')).mode & 0o111) === 0) throw new Error('Chromium 不可执行');
if ((fs.statSync(path.join(root, 'python', 'bin', 'python3')).mode & 0o111) === 0) throw new Error('Python 不可执行');
if (fs.readdirSync(path.join(root, 'analyzer', 'wheelhouse')).length === 0) throw new Error('Analyzer wheelhouse 为空');
if (fs.readdirSync(path.join(root, 'licenses')).length === 0) throw new Error('第三方许可证目录为空');

const crypto = await import('node:crypto');
const manifestPath = path.join(root, 'runtime-files.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
if (manifest.version !== 1 || !Array.isArray(manifest.files)) throw new Error('runtime-files.json 格式无效');
const seen = new Set();
for (const item of manifest.files) {
  if (typeof item.path !== 'string' || path.isAbsolute(item.path) || item.path.split(path.sep).includes('..') || seen.has(item.path)) throw new Error('runtime manifest 路径无效或重复');
  seen.add(item.path);
  const absolute = path.join(root, item.path);
  if (!fs.existsSync(absolute) || fs.statSync(absolute).size !== item.size) throw new Error(`runtime 文件大小不符: ${item.path}`);
  const digest = crypto.createHash('sha256').update(fs.readFileSync(absolute)).digest('hex');
  if (digest !== item.sha256) throw new Error(`runtime 文件哈希不符: ${item.path}`);
}
const actual = new Set();
const walk = (directory) => {
  for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
    const absolute = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`runtime 不允许符号链接: ${absolute}`);
    if (entry.isDirectory()) walk(absolute);
    else if (entry.isFile() && absolute !== manifestPath) actual.add(path.relative(root, absolute));
  }
};
walk(root);
if (actual.size !== seen.size || [...actual].some((item) => !seen.has(item))) throw new Error('runtime 文件集与清单不一致');
