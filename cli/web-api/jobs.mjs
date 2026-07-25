/**
 * 任务执行:把网页发来的结构化选项组装成 tsuzuri CLI 的 argv,起子进程渲染/出图,
 * 并把子进程 fd 3 上的 NDJSON 进度事件(契约一,由 term.mjs/progress.mjs 产出)
 * 收集起来供 HTTP 层轮询或 SSE 推送。本模块不碰 http/fs,argv 组装是纯函数,
 * 方便单测直接调用。
 */
import {spawn as spawnActual} from 'node:child_process';
import crypto from 'node:crypto';
import path from 'node:path';
import readline from 'node:readline';
import {fileURLToPath} from 'node:url';

import {FILTER_IDS} from '../filters.mjs';

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const TSUZURI_ENTRY = path.join(REPO_ROOT, 'cli', 'tsuzuri.mjs');

export class JobValidationError extends Error {
  constructor(field, message) {
    super(message);
    this.field = field;
  }
}

const FORMATS = ['landscape', 'portrait', 'square'];
const TRIM_VALUES = ['auto', 'full'];

/**
 * 把 {kind, folder, options} 组装成 tsuzuri CLI 的 argv 数组。
 * `folder` 在这里已经是调用方(HTTP 层)用 resolveSafePath 校验过的绝对路径,
 * 本函数不做任何 fs 校验,只做字段合法性校验与 argv 拼接——这是唯一被允许
 * 生成 argv 的地方,前端传来的原始 argv/命令字符串一律不被接受(契约二安全前提 1)。
 * @param {{kind: 'render'|'still', folder: string, options?: object}} params
 * @returns {string[]}
 */
export const buildJobArgv = ({kind, folder, options = {}}) => {
  if (kind !== 'render' && kind !== 'still') {
    throw new JobValidationError('kind', 'kind 必须是 render 或 still');
  }
  const opts = options ?? {};
  const flags = [];

  const readBool = (field) => {
    const value = opts[field];
    if (value === undefined) return false;
    if (typeof value !== 'boolean') {
      throw new JobValidationError(field, `${field} 必须是布尔值`);
    }
    return value;
  };

  if (readBool('exif')) flags.push('--exif');
  if (readBool('sign')) flags.push('--sign');
  if (readBool('dark')) flags.push('--dark');

  const format = opts.format === undefined ? 'landscape' : opts.format;
  if (!FORMATS.includes(format)) {
    throw new JobValidationError('format', 'format 必须是 landscape、portrait 或 square 之一');
  }
  if (format === 'portrait') flags.push('--portrait');
  if (format === 'square') flags.push('--square');

  const hasFilter = opts.filter !== undefined && opts.filter !== null;
  if (hasFilter && !FILTER_IDS.includes(opts.filter)) {
    throw new JobValidationError('filter', `filter 必须是以下之一: ${FILTER_IDS.join(', ')}`);
  }

  const hasFilterIntensity = opts.filterIntensity !== undefined && opts.filterIntensity !== null;
  if (hasFilterIntensity) {
    if (typeof opts.filterIntensity !== 'number' || opts.filterIntensity < 0 || opts.filterIntensity > 1) {
      throw new JobValidationError('filterIntensity', 'filterIntensity 必须是 0–1 之间的数字');
    }
    if (!hasFilter) {
      throw new JobValidationError('filterIntensity', '--filter-intensity 需要搭配 --filter <id> 使用');
    }
  }

  if (hasFilter) flags.push('--filter', opts.filter);
  if (hasFilterIntensity) flags.push('--filter-intensity', String(opts.filterIntensity));

  if (kind === 'render') {
    const draft = readBool('draft');
    if (draft) flags.push('--draft');

    const hasTrim = opts.trim !== undefined && opts.trim !== null;
    if (hasTrim) {
      if (!TRIM_VALUES.includes(opts.trim)) {
        throw new JobValidationError('trim', 'trim 必须是 auto 或 full');
      }
      flags.push('--trim', opts.trim);
    }
  }

  if (kind === 'still') {
    const scale = opts.scale === undefined ? 2 : opts.scale;
    if (typeof scale !== 'number' || !Number.isInteger(scale) || scale < 1 || scale > 4) {
      throw new JobValidationError('scale', 'scale 必须是 1–4 的整数');
    }
    flags.push('--scale', String(scale));
  }

  return kind === 'still' ? ['still', folder, ...flags] : [folder, ...flags];
};

/** 取消后等子进程体面退出的宽限期,超时就 SIGKILL。 */
const FORCE_KILL_AFTER_MS = 8000;

/**
 * @param {{spawnImpl?: Function, killImpl?: Function}} [deps]
 *   spawnImpl 默认真实 child_process.spawn,测试可注入假实现避免真的起渲染进程。
 *   killImpl 同理默认真实 process.kill,单测用它断言"取消时确实尝试杀了整个
 *   进程组"而不依赖真实进程组行为——生产代码不要传这个参数。
 */
export const createJobManager =({spawnImpl = spawnActual, killImpl = process.kill} = {}) => {
  /** @type {Map<string, object>} */
  const jobs = new Map();
  let runningJobId = null;

  const createJob = ({kind, folder, options}) => {
    if (runningJobId !== null) {
      return {error: 'busy'};
    }
    // 校验失败在这里往外抛 JobValidationError,交给 HTTP 层捕获转 400。
    const argv = buildJobArgv({kind, folder, options});

    const id = crypto.randomUUID();
    // detached: true 让子进程成为一个新进程组的组长。渲染/出图任务会再往下拉起
    // remotion/chromium 等孙子进程,child.kill() 只能杀直接子进程,孙子进程(尤其
    // 是渲染用的 chromium)会变成孤儿继续占着资源跑;取消时改用
    // process.kill(-child.pid, 'SIGTERM')(负 pid 表示对整个进程组发信号)才能
    // 把这一整棵进程树斩草除根。
    const child = spawnImpl(process.execPath, [TSUZURI_ENTRY, ...argv], {
      stdio: ['ignore', 'pipe', 'pipe', 'pipe'],
      detached: true,
      env: {...process.env, TSUZURI_JSON_PROGRESS: '1'},
    });

    const job = {id, kind, status: 'running', exitCode: null, events: [], child, cancelled: false, listeners: new Set(), killTimer: null};
    jobs.set(id, job);
    runningJobId = id;

    // stdout/stderr 不需要暴露给前端(契约没有要求),但必须消费掉,否则子进程
    // 写满 pipe 缓冲区之后会被阻塞挂起。
    child.stdio[1]?.resume?.();
    child.stdio[2]?.resume?.();

    let rl = null;
    const fd3 = child.stdio[3];
    if (fd3) {
      // fd 3 是否存在、读取过程中是否出错,都必须静默处理——它只是进度信息的
      // 旁路出口,不能因为读不到/读坏了就把整个任务管理流程带崩。
      try {
        rl = readline.createInterface({input: fd3});
        rl.on('line', (line) => {
          let event;
          try {
            event = JSON.parse(line);
          } catch {
            // 单行解析失败直接跳过,不能让一行坏数据打断后续事件。
            return;
          }
          job.events.push(event);
          const chunk = `data: ${JSON.stringify(event)}\n\n`;
          for (const listener of job.listeners) listener(chunk);
        });
        rl.on('error', () => {});
        fd3.on?.('error', () => {});
      } catch {
        rl = null;
      }
    }

    // spawn 失败(EAGAIN/EMFILE 等)时 ChildProcess 发 'error' 而**不发** 'exit'。
    // 没有监听器时 EventEmitter 会直接 throw,在 server 里就是 uncaughtException;
    // 就算不崩,不发 exit 也意味着 runningJobId 永远不释放,此后所有任务都 409。
    child.on('error', () => {
      if (job.status !== 'running') return;
      job.status = 'failed';
      job.exitCode = null;
      rl?.close();
      finish(job);
    });

    child.on('exit', (code) => {
      job.status = job.cancelled ? 'cancelled' : code === 0 ? 'done' : 'failed';
      job.exitCode = code;
      if (job.killTimer !== null) {
        clearTimeout(job.killTimer);
        job.killTimer = null;
      }
      rl?.close();
      finish(job);
    });

    return {id};
  };

  /** 广播 end 帧、清监听器、释放并发锁。exit 与 error 两条收尾路径共用。 */
  const finish = (job) => {
    const endChunk = `event: end\ndata: ${JSON.stringify({status: job.status, exitCode: job.exitCode})}\n\n`;
    for (const listener of job.listeners) listener(endChunk);
    job.listeners.clear();
    if (runningJobId === job.id) runningJobId = null;
  };

  const getJob = (id) => {
    const job = jobs.get(id);
    if (!job) return null;
    return {id: job.id, kind: job.kind, status: job.status, exitCode: job.exitCode, events: [...job.events]};
  };

  const subscribeEvents = (id, listener) => {
    const job = jobs.get(id);
    if (!job) return null;
    // 迟到的订阅者也要能补上已经发生过的事件,先把缓冲区里已有的逐条重放一遍。
    for (const event of job.events) listener(`data: ${JSON.stringify(event)}\n\n`);
    if (job.status !== 'running') {
      listener(`event: end\ndata: ${JSON.stringify({status: job.status, exitCode: job.exitCode})}\n\n`);
      return () => {};
    }
    job.listeners.add(listener);
    // 客户端断开连接时 HTTP 层要调用这个 unsubscribe,否则 job.listeners 会一直
    // 攒着已经没人接收的回调,直到任务结束才清空——短任务还好,长任务加上频繁的
    // 客户端断线重连会造成明显的内存泄漏。
    return () => job.listeners.delete(listener);
  };

  /** 向整个进程组发信号。负 pid 配合 detached: true 覆盖 remotion 拉起的孙进程。 */
  const signalGroup = (job, signal) => {
    try {
      killImpl(-job.child.pid, signal);
    } catch {
      // 进程可能已经退出,或权限问题——取消语义上已经"发起"了,不该报 500。
    }
  };

  const cancelJob = (id) => {
    const job = jobs.get(id);
    if (!job) return false;
    if (job.status !== 'running') return false;
    job.cancelled = true;
    signalGroup(job, 'SIGTERM');
    // SIGTERM 是"请你退出",remotion/chromium 吞掉它是常见现象。没有兜底的话
    // 子进程不死 → 'exit' 不来 → runningJobId 永不释放 → 之后每个任务都 409,
    // 用户只能重启 server。给它 8 秒体面退出的机会,然后 SIGKILL。
    if (job.killTimer === null) {
      job.killTimer = setTimeout(() => {
        job.killTimer = null;
        if (job.status === 'running') signalGroup(job, 'SIGKILL');
      }, FORCE_KILL_AFTER_MS);
      // 这个定时器不该拖着进程不让退出
      job.killTimer.unref?.();
    }
    return true;
  };

  /**
   * 杀掉所有还在跑的任务。detached: true 让子进程 setsid() 脱离了终端进程组,
   * 用户按 Ctrl+C 时 SIGINT 只发给前台进程组,子进程收不到 —— 不显式收尾,
   * 关掉 tsuzuri web 之后 remotion/chromium 会变成孤儿继续吃满 CPU 直到渲染完。
   */
  const killAll = () => {
    for (const job of jobs.values()) {
      if (job.status !== 'running') continue;
      job.cancelled = true;
      signalGroup(job, 'SIGTERM');
    }
  };

  /** 仅供测试观测 SSE 监听者是否被正确清理,生产代码不要用。 */
  const _debugListenerCount = (id) => jobs.get(id)?.listeners.size ?? 0;

  return {createJob, getJob, subscribeEvents, cancelJob, killAll, _debugListenerCount};
};
