import {writeSync} from 'node:fs';

const JSON_PROGRESS_FD = 3;
const LINE_ERASE = '\r\x1b[2K';
const TASK_INTERVAL_MS = 80;

const COLORS = {
  info: '39',
  start: '38;2;217;119;87',
  success: '32',
  warn: '33',
  error: '31',
  prompt: '36',
  path: '36',
  dim: '2',
};

export const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

export const ansiEnabled = (stream, env = process.env) =>
  Boolean(stream?.isTTY) &&
  !hasOwn(env, 'NO_COLOR') &&
  String(env.TERM ?? '').toLowerCase() !== 'dumb';

/** 按 ansiEnabled 决定是否包 ANSI;交互提示与状态输出共用同一套降级判断. */
export const paint = (kind, text, stream = process.stdout, env = process.env) =>
  ansiEnabled(stream, env) ? `\x1b[${COLORS[kind]}m${text}\x1b[0m` : text;

export const dim = (text, stream = process.stdout, env = process.env) =>
  paint('dim', text, stream, env);

/** 提问行前缀:cyan `?`,让"等输入"与"● 输出结果"一眼可分. */
export const promptPrefix = (stream = process.stdout, env = process.env) =>
  paint('prompt', '?', stream, env);

export const formatDuration = (ms) => {
  const elapsed = Number(ms);
  const safe = Number.isFinite(elapsed) && elapsed > 0 ? elapsed : 0;
  if (safe < 60_000) return `${(safe / 1000).toFixed(1)}s`;
  const totalSeconds = Math.round(safe / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
};

const linesOf = (message) => {
  const lines = String(message).split(/\r?\n/);
  return lines.length > 0 ? lines : [''];
};

/** 结构化进度出口开关:必须显式设为 '1',其余取值(含未设置)一律关闭,终端行为零变化. */
export const jsonProgressEnabled = (env = process.env) => env.KISEKI_JSON_PROGRESS === '1';

/** 默认 JSON 写入器:落到 fd 3.fd 3 未打开时 writeSync 抛 EBADF,吞掉——结构化出口是尽力而为,绝不能带崩 CLI. */
export const defaultJsonWrite = (event) => {
  try {
    writeSync(JSON_PROGRESS_FD, `${JSON.stringify(event)}\n`);
  } catch {
    // fd 3 未打开或写入失败:静默丢弃.
  }
};

const writeBullet = (kind, text, stream, env) => {
  const dot = ansiEnabled(stream, env) ? `\x1b[${COLORS[kind]}m●\x1b[0m` : '●';
  stream.write(`${dot} ${text}\n`);
};

export const createTerminal = ({
  stdout = process.stdout,
  stderr = process.stderr,
  env = process.env,
  jsonWrite = defaultJsonWrite,
  now = Date.now,
  setInterval: setIntervalFn = setInterval,
  clearInterval: clearIntervalFn = clearInterval,
} = {}) => {
  const jsonEnabled = jsonProgressEnabled(env);
  const interactive = ansiEnabled(stdout, env);
  const emitJson = (kind, message) => {
    if (!jsonEnabled) return;
    for (const line of linesOf(message)) jsonWrite({kind, text: line});
  };

  let active = null;

  const stopTimer = (task) => {
    if (task?.timer == null) return;
    clearIntervalFn(task.timer);
    task.timer = null;
  };

  const writeRunning = (task) => {
    const frame = SPINNER_FRAMES[task.frame % SPINNER_FRAMES.length];
    const spinner = paint('start', frame, stdout, env);
    const elapsed = dim(formatDuration(now() - task.startedAt), stdout, env);
    stdout.write(`${LINE_ERASE}${spinner} ${task.label} ${elapsed}`);
    task.parked = false;
  };

  const startTimer = (task) => {
    if (!interactive || task.timer != null || task.done) return;
    const timer = setIntervalFn(() => {
      if (task.done || task !== active) return;
      task.frame += 1;
      writeRunning(task);
    }, TASK_INTERVAL_MS);
    if (timer && typeof timer === 'object' && typeof timer.unref === 'function') timer.unref();
    task.timer = timer;
  };

  const parkLine = (task) => {
    if (!task || task.done) return;
    stopTimer(task);
    if (interactive && !task.parked) {
      stdout.write('\n');
      task.parked = true;
    }
  };

  const resumeLine = (task) => {
    if (!task || task.done || !interactive) return;
    writeRunning(task);
    startTimer(task);
  };

  const withActiveTask = (write) => {
    const task = active && !active.done ? active : null;
    const shouldPark = Boolean(task && interactive);
    if (shouldPark) parkLine(task);
    write();
    if (shouldPark && active === task && !task.done) resumeLine(task);
  };

  const emit = (kind, message, stream) => {
    withActiveTask(() => {
      for (const line of linesOf(message)) writeBullet(kind, line, stream, env);
      emitJson(kind, message);
    });
  };

  const detail = (message) => {
    withActiveTask(() => {
      for (const line of linesOf(message)) {
        const output = `└ ${line}`;
        stdout.write(ansiEnabled(stdout, env) ? `\x1b[2m${output}\x1b[0m\n` : `${output}\n`);
      }
      emitJson('detail', message);
    });
  };

  const finishTask = (task, kind, text) => {
    if (task.done) return;
    task.done = true;
    stopTimer(task);
    if (active === task) active = null;
    const durationMs = Math.max(0, Math.round(now() - task.startedAt));
    const stream = kind === 'error' ? stderr : stdout;
    const suffix = dim(`  ${formatDuration(durationMs)}`, stream, env);
    const line = `${text}${suffix}`;
    if (interactive && !task.parked) {
      if (kind === 'error') {
        stdout.write(LINE_ERASE);
        writeBullet(kind, line, stderr, env);
      } else {
        stdout.write(LINE_ERASE);
        writeBullet(kind, line, stdout, env);
      }
    } else {
      writeBullet(kind, line, stream, env);
    }
    if (jsonEnabled) jsonWrite({kind, text, stage: task.label, durationMs});
  };

  const task = (label) => {
    if (active && !active.done) parkLine(active);
    const state = {
      label,
      startedAt: now(),
      timer: null,
      frame: 0,
      parked: true,
      done: false,
    };
    active = state;
    if (jsonEnabled) jsonWrite({kind: 'start', text: label, stage: label});
    if (interactive) {
      writeRunning(state);
      startTimer(state);
    } else {
      writeBullet('start', label, stdout, env);
    }
    return {
      succeed: (text = label) => finishTask(state, 'success', text),
      fail: (text = label) => finishTask(state, 'error', text),
      endLine: () => {
        if (active === state) parkLine(state);
      },
    };
  };

  return {
    info: (message) => emit('info', message, stdout),
    start: (message) => emit('start', message, stdout),
    success: (message) => emit('success', message, stdout),
    warn: (message) => emit('warn', message, stderr),
    error: (message) => emit('error', message, stderr),
    detail,
    task,
  };
};

export const term = createTerminal();
