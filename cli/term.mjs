import {writeSync} from 'node:fs';

const JSON_PROGRESS_FD = 3;

const COLORS = {
  info: '39',
  start: '38;2;217;119;87',
  success: '32',
  warn: '33',
  error: '31',
  prompt: '36',
  dim: '2',
};

const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

export const ansiEnabled = (stream, env = process.env) =>
  Boolean(stream?.isTTY) &&
  !hasOwn(env, 'NO_COLOR') &&
  String(env.TERM ?? '').toLowerCase() !== 'dumb';

/** 按 ansiEnabled 决定是否包 ANSI;交互提示与状态输出共用同一套降级判断。 */
export const paint = (kind, text, stream = process.stdout, env = process.env) =>
  ansiEnabled(stream, env) ? `\x1b[${COLORS[kind]}m${text}\x1b[0m` : text;

export const dim = (text, stream = process.stdout, env = process.env) =>
  paint('dim', text, stream, env);

/** 提问行前缀:cyan `?`,让"等输入"与"● 输出结果"一眼可分。 */
export const promptPrefix = (stream = process.stdout, env = process.env) =>
  paint('prompt', '?', stream, env);

const linesOf = (message) => {
  const lines = String(message).split(/\r?\n/);
  return lines.length > 0 ? lines : [''];
};

/** 结构化进度出口开关:必须显式设为 '1',其余取值(含未设置)一律关闭,终端行为零变化。 */
export const jsonProgressEnabled = (env = process.env) => env.TSUZURI_JSON_PROGRESS === '1';

/** 默认 JSON 写入器:落到 fd 3。fd 3 未打开时 writeSync 抛 EBADF,吞掉——结构化出口是尽力而为,绝不能带崩 CLI。 */
export const defaultJsonWrite = (event) => {
  try {
    writeSync(JSON_PROGRESS_FD, `${JSON.stringify(event)}\n`);
  } catch {
    // fd 3 未打开或写入失败:静默丢弃。
  }
};

export const createTerminal = ({
  stdout = process.stdout,
  stderr = process.stderr,
  env = process.env,
  jsonWrite = defaultJsonWrite,
} = {}) => {
  const jsonEnabled = jsonProgressEnabled(env);
  const emitJson = (kind, message) => {
    if (!jsonEnabled) return;
    for (const line of linesOf(message)) jsonWrite({kind, text: line});
  };

  const emit = (kind, message, stream) => {
    const dot = ansiEnabled(stream, env) ? `\x1b[${COLORS[kind]}m●\x1b[0m` : '●';
    for (const line of linesOf(message)) stream.write(`${dot} ${line}\n`);
    emitJson(kind, message);
  };

  const detail = (message) => {
    for (const line of linesOf(message)) {
      const output = `└ ${line}`;
      stdout.write(ansiEnabled(stdout, env) ? `\x1b[2m${output}\x1b[0m\n` : `${output}\n`);
    }
    emitJson('detail', message);
  };

  return {
    info: (message) => emit('info', message, stdout),
    start: (message) => emit('start', message, stdout),
    success: (message) => emit('success', message, stdout),
    warn: (message) => emit('warn', message, stderr),
    error: (message) => emit('error', message, stderr),
    detail,
  };
};

export const term = createTerminal();
