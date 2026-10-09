import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const desktop = path.dirname(fileURLToPath(import.meta.url));
const repo = path.dirname(desktop);
const runtime = path.join(desktop, 'staging', 'runtime');
const bin = path.join(runtime, 'bin');

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, {stdio: 'inherit', ...options});
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} 失败`);
};

const copyTree = (from, to, skip = new Set()) => {
  fs.mkdirSync(to, {recursive: true});
  for (const name of fs.readdirSync(from)) {
    if (skip.has(name)) continue;
    fs.cpSync(path.join(from, name), path.join(to, name), {recursive: true, dereference: false});
  }
};

const executableName = (name) => (process.platform === 'win32' ? `${name}.exe` : name);

const stageNode = () => {
  fs.copyFileSync(process.execPath, path.join(bin, executableName('node')));
  fs.chmodSync(path.join(bin, executableName('node')), 0o755);
};

const stageProjects = () => {
  copyTree(path.join(repo, 'cli'), path.join(runtime, 'cli'), new Set(['node_modules']));
  run('npm', ['ci', '--omit=dev'], {cwd: path.join(runtime, 'cli')});
  copyTree(path.join(repo, 'renderer'), path.join(runtime, 'renderer'), new Set(['node_modules', 'out']));
  run('npm', ['ci', '--omit=dev'], {cwd: path.join(runtime, 'renderer')});
  const webIndex = path.join(repo, 'web', 'dist', 'index.html');
  if (!fs.existsSync(webIndex)) throw new Error('还没有网页构建。先执行 npm --prefix web run build');
  fs.cpSync(path.join(repo, 'web', 'dist'), path.join(runtime, 'web', 'dist'), {recursive: true});
  copyTree(path.join(repo, 'analyzer'), path.join(runtime, 'analyzer'), new Set(['.venv', 'tests', '__pycache__', '.remotion', '.pytest_cache', '.ruff_cache']));
};

fs.rmSync(runtime, {recursive: true, force: true});
fs.mkdirSync(bin, {recursive: true});
console.log('准备 Node');
stageNode();
console.log('准备网页、命令行、渲染器和分析源码');
stageProjects();
console.log(`当前系统的运行环境已放在 ${runtime}`);
