import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import crypto from 'node:crypto';

const desktop = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const repo = path.dirname(desktop);
const destination = path.join(desktop, 'staging', 'kiseki-runtime');
fs.rmSync(destination, {recursive: true, force: true});
fs.mkdirSync(destination, {recursive: true});
for (const [source, target] of [['cli', 'cli'], ['web/dist', 'web/dist'], ['renderer', 'renderer'], ['analyzer', 'analyzer']]) {
  fs.cpSync(path.join(repo, source), path.join(destination, target), {recursive: true, dereference: true, filter: (item) => !item.includes(`${path.sep}.venv${path.sep}`) && !item.includes(`${path.sep}.git${path.sep}`)});
}
fs.mkdirSync(path.join(destination, 'bin'), {recursive: true});
fs.mkdirSync(path.join(destination, 'licenses'), {recursive: true});

const requiredInputs = {
  ffmpeg: process.env.KISEKI_FFMPEG_BIN,
  ffprobe: process.env.KISEKI_FFPROBE_BIN,
  uv: process.env.KISEKI_UV_BIN,
  chromium: process.env.KISEKI_CHROMIUM_BIN,
  wheelhouse: process.env.KISEKI_ANALYZER_WHEELHOUSE,
  licenses: process.env.KISEKI_RUNTIME_LICENSES,
  python: process.env.KISEKI_PYTHON_RUNTIME,
};
const inputNames = {ffmpeg: 'KISEKI_FFMPEG_BIN', ffprobe: 'KISEKI_FFPROBE_BIN', uv: 'KISEKI_UV_BIN', chromium: 'KISEKI_CHROMIUM_BIN', wheelhouse: 'KISEKI_ANALYZER_WHEELHOUSE', licenses: 'KISEKI_RUNTIME_LICENSES', python: 'KISEKI_PYTHON_RUNTIME'};
for (const [name, source] of Object.entries(requiredInputs)) {
  if (!source) throw new Error(`缺少构建输入 ${inputNames[name]}`);
  if (!fs.existsSync(source)) throw new Error(`构建输入不存在: ${source}`);
}
for (const name of ['ffmpeg', 'ffprobe', 'uv']) {
  fs.copyFileSync(requiredInputs[name], path.join(destination, 'bin', name));
  fs.chmodSync(path.join(destination, 'bin', name), 0o755);
}
fs.cpSync(requiredInputs.chromium, path.join(destination, 'chromium'), {recursive: true, dereference: true});
fs.cpSync(requiredInputs.python, path.join(destination, 'python'), {recursive: true, dereference: true});
fs.cpSync(requiredInputs.wheelhouse, path.join(destination, 'analyzer', 'wheelhouse'), {recursive: true, dereference: true});
fs.cpSync(requiredInputs.licenses, path.join(destination, 'licenses'), {recursive: true, dereference: true});
if (!fs.existsSync(path.join(destination, 'cli', 'node_modules', 'exifr', 'package.json'))) throw new Error('请先按 cli/package-lock.json 安装 CLI 生产依赖');

const files = [];
const walk = (directory) => {
  for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
    const absolute = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`runtime 不允许符号链接: ${absolute}`);
    if (entry.isDirectory()) walk(absolute);
    else if (entry.isFile()) files.push(absolute);
  }
};
walk(destination);
const manifest = files.sort().map((absolute) => ({
  path: path.relative(destination, absolute),
  size: fs.statSync(absolute).size,
  sha256: crypto.createHash('sha256').update(fs.readFileSync(absolute)).digest('hex'),
}));
fs.writeFileSync(path.join(destination, 'runtime-files.json'), `${JSON.stringify({version: 1, files: manifest}, null, 2)}\n`);
