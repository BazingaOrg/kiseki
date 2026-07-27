/**
 * 任务执行:把网页发来的结构化选项组装成一条"命令 + 参数 + 进度来源"的任务描述,
 * 起子进程执行,并把进度事件(契约一的形状)收集起来供 HTTP 层轮询或 SSE 推送。
 *
 * 任务有两种形态,差异全部收敛在 buildJobSpec 里,对前端完全透明:
 * - `progressSource: 'fd3'` —— 跑 tsuzuri CLI,读 fd 3 上的 NDJSON(term.mjs 产出)。
 * - `progressSource: 'ytdlp-stdout'` —— 直接跑 yt-dlp,它不认识 fd 3,进度写在
 *   stdout 上的 `[download]  42.3% of ...`,由本模块翻译成同一份事件形状。
 *
 * 本模块不碰 http,argv/spec 组装尽量做成纯函数,方便单测直接调用。
 */
import {spawn as spawnActual, spawnSync} from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import {fileURLToPath} from 'node:url';

import {buildAudioFilename, installDownloadedAudio, sanitizeFilePart} from '../fetch.mjs';
import {FIXES} from '../dependencies.mjs';
import {scanFolderLoose} from '../project.mjs';
import {JobValidationError, buildJobInvocation} from '../job-argv.mjs';

export {JobValidationError, buildJobArgv, buildJobEnv, buildJobInvocation} from '../job-argv.mjs';

// 本文件在 cli/web-api/ 下,往上两级正好是 cli/ —— 不是仓库根目录。
// 之前这里当成仓库根再拼 'cli/tsuzuri.mjs',结果是 cli/cli/tsuzuri.mjs,
// 子进程起手就 Cannot find module 退出 1,而且 stderr 被丢弃、fd 3 一条事件
// 都没有,前端只看到一句"失败了"。单测全都注入 spawnImpl,碰不到真实路径。
const CLI_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const TSUZURI_ENTRY = path.join(CLI_DIR, 'tsuzuri.mjs');

/** 失败时回带的 stderr 行数上限,够定位又不至于把整屏日志灌给前端。 */
const STDERR_TAIL_LINES = 5;

// ---------------------------------------------------------------------------
// yt-dlp 进度解析
// ---------------------------------------------------------------------------

// yt-dlp 在有 tty 时会给百分比上色(即使我们传了 --no-color,某些版本/插件仍会漏),
// 先剥掉 CSI 序列再匹配,免得 `[download]` 前面挂着颜色码就整行认不出来。
const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;
const YTDLP_PROGRESS_RE = /^\[download\]\s+(\d{1,3}(?:\.\d+)?)%/;

/** yt-dlp 下载进度事件的标签,前端拿到的形状与渲染任务完全一致。 */
export const YTDLP_PROGRESS_LABEL = '下载音频';

/**
 * 把 yt-dlp 的一行 stdout 翻译成契约一的 progress 事件;不是进度行返回 null。
 * @param {string} line
 * @returns {{kind: 'progress', label: string, percent: number}|null}
 */
export const parseYtDlpProgress = (line) => {
  const clean = String(line ?? '').replace(ANSI_RE, '').trim();
  const match = YTDLP_PROGRESS_RE.exec(clean);
  if (!match) return null;
  const value = Number.parseFloat(match[1]);
  // `\d{1,3}` 会放过 999% 这种畸形输出,percent 必须是 0–100 的整数(契约一)。
  if (!Number.isFinite(value) || value < 0 || value > 100) return null;
  return {kind: 'progress', label: YTDLP_PROGRESS_LABEL, percent: Math.round(value)};
};

// ---------------------------------------------------------------------------
// 任务描述:命令 + 参数 + 进度来源
// ---------------------------------------------------------------------------

const YTDLP_ID_RE = /^[A-Za-z0-9_-]{5,64}$/;

const readOptionalString = (value, field) => {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string') throw new JobValidationError(field, `${field} 必须是字符串`);
  return value;
};

/**
 * Web 下载与 CLI 使用同一个 filename builder。这里在创建任务前规范化字段；最终
 * 安装时仍由 installDownloadedAudio 再次拒绝同名文件，覆盖下载期间的竞态。
 */
const normalizeFetchAudioMetadata = (options) => {
  const title = sanitizeFilePart(readOptionalString(options?.title, 'title'));
  if (!title) throw new JobValidationError('title', 'title 不能为空');
  const artist = sanitizeFilePart(readOptionalString(options?.artist, 'artist'));
  return {title, artist};
};

/**
 * fetch-audio:直接跑 yt-dlp 下载到素材夹外的临时目录,退出后再安装进 audio/。
 * 下载参数与 cli/ytdlp.mjs 的 downloadWithYtDlp 保持一致(那边是 spawnSync,
 * 拿不到流式进度,所以这里只能自己拼参数);**安装逻辑仍然复用 fetch.mjs**,
 * 不另写一份替换/回滚。
 */
const buildFetchAudioSpec = ({folder, options, tempParent}) => {
  const id = options?.id;
  if (typeof id !== 'string' || !YTDLP_ID_RE.test(id)) {
    throw new JobValidationError('id', 'id 必须是 yt-dlp 视频 id(字母、数字、- 和 _)');
  }
  const {title, artist} = normalizeFetchAudioMetadata(options);

  // 先校验完再建临时目录,非法请求不该在 /tmp 里留垃圾。
  const tempDir = fs.mkdtempSync(path.join(tempParent, 'tsuzuri-fetch-'));
  return {
    command: 'yt-dlp',
    // 暴露出去,好让 killAll 这种来不及等 'exit' 的收尾路径也能把它删掉
    tempDir,
    // --newline:yt-dlp 默认用 \r 原地刷进度条,不换行的话 readline 一行都读不到,
    // 进度会一直卡在不确定态直到下载结束。
    args: [
      '-x', '--audio-format', 'm4a', '--no-playlist', '--newline', '--no-color',
      '-o', path.join(tempDir, '%(title)s.%(ext)s'),
      `https://www.youtube.com/watch?v=${id}`,
    ],
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
    progressSource: 'ytdlp-stdout',
    finalize: (code, {stderrTail = [], spawnFailed = false} = {}) => {
      try {
        if (spawnFailed) {
          // 进程压根没起来,几乎只有一种原因:yt-dlp 没装或不在 PATH。
          // 报"网络/地区限制"会把人带到完全错误的方向。
          return {ok: false, events: [{kind: 'error', text: `起不了 yt-dlp,确认它已安装并在 PATH 里。${FIXES['yt-dlp']}`}]};
        }
        if (code !== 0) {
          const detail = stderrTail.length > 0 ? `\n${stderrTail.join('\n')}` : '';
          return {ok: false, events: [{kind: 'error', text: `下载失败(网络、地区限制或 yt-dlp 版本过旧)${detail}`}]};
        }
        const audios = scanFolderLoose(tempDir).audios;
        if (audios.length !== 1) {
          return {ok: false, events: [{kind: 'error', text: '下载结果不是单个音频文件'}]};
        }
        const filename = buildAudioFilename({title, artist, ext: path.extname(audios[0])});
        const installed = installDownloadedAudio({
          source: path.join(tempDir, audios[0]),
          folder,
          filename,
        });
        return {ok: true, events: [{kind: 'success', text: `音频已就绪: ${installed}`}]};
      } catch (error) {
        // 目标文件已存在等安装期错误在这里落地成一条 error 事件,任务判失败。
        // 绝不能往上抛:这是在子进程 'exit' 回调里跑的,抛出去就是 uncaughtException。
        return {ok: false, events: [{kind: 'error', text: error.message}]};
      } finally {
        fs.rmSync(tempDir, {recursive: true, force: true});
      }
    },
  };
};

/**
 * 按 kind 分派出"命令 + 参数 + 进度来源"。这是 createJob 与具体命令之间唯一的接缝,
 * 新增任务形态只需要在这里加一支,并发锁/取消/SSE 收尾全部自动生效。
 * @param {{kind: string, folder: string, options?: object, tempParent?: string}} params
 */
export const buildJobSpec = ({kind, folder, options = {}, tempParent = os.tmpdir()}) => {
  if (kind === 'fetch-audio') return buildFetchAudioSpec({folder, options, tempParent});

  const {argv, env} = buildJobInvocation({kind, folder, options});

  return {
    command: process.execPath,
    args: [TSUZURI_ENTRY, ...argv],
    // stdin 'ignore' 让子进程的 process.stdin.isTTY 为 false,
    // maybePersistTrimChoice / offerFetch 的交互分支会自动跳过(契约二)。
    stdio: ['ignore', 'pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      TSUZURI_JSON_PROGRESS: '1',
      ...env,
    },
    progressSource: 'fd3',
    finalize: null,
  };
};

/**
 * 取消后等进程组体面退出的宽限期,超时就 SIGKILL。
 * 取 3 秒而不是更长:取消的语义是"现在就停",而这期间十几个 chromium 在满负荷跑。
 */
const FORCE_KILL_AFTER_MS = 3000;

/**
 * fetch-audio 的停滞阈值。yt-dlp 下载期间每秒都在刷进度,超过这么久一条都没有,
 * 基本就是卡死了(代理挂了但 TCP 不断是最常见的形态)。不加这个,一个永远到不了
 * 100% 的下载会一直占着并发锁,用户不点取消就再也起不了任何任务。
 *
 * **只对 fetch-audio 生效**:whisper 识别会先安静好几分钟再一次性吐结果,
 * 对它做停滞检测必然误杀。
 */
const STALL_TIMEOUT_MS = 120_000;

/** 停滞检查的轮询间隔。 */
const STALL_CHECK_INTERVAL_MS = 15_000;

/** 内存里最多保留多少条任务记录。本地单人工具,留最近的够回看就行。 */
const MAX_JOBS_KEPT = 20;

  /**
 * 列出某个 pid 的全部后代(含自身之外的各级子孙)。
 *
 * 为什么不能只靠进程组:puppeteer/remotion 起 chromium 时自己也用了 detached,
 * 浏览器进城在**它自己的进程组**里,`kill(-pgid)` 够不到 —— 实测取消一次渲染,
 * render.mjs 死了但 13 个 chromium 全部存活(闲置不吃 CPU,但也永远不退)。
 *
 * 必须在树还完整的时候快照:一旦中间的 render.mjs 被杀,chromium 会被 reparent
 * 到 launchd/init,从我们的 pid 再也走不到它们。
 */
export const listDescendants = (rootPid, readTable = defaultReadProcessTable) => {
  const table = readTable();
  const childrenOf = new Map();
  for (const line of table.split('\n')) {
    const match = /^\s*(\d+)\s+(\d+)\s*$/.exec(line);
    if (!match) continue;
    const pid = Number(match[1]);
    const ppid = Number(match[2]);
    if (!childrenOf.has(ppid)) childrenOf.set(ppid, []);
    childrenOf.get(ppid).push(pid);
  }
  const found = [];
  const queue = [rootPid];
  const seen = new Set([rootPid]);
  while (queue.length > 0) {
    for (const child of childrenOf.get(queue.shift()) ?? []) {
      if (seen.has(child)) continue;
      seen.add(child);
      found.push(child);
      queue.push(child);
    }
  }
  return found;
};

const defaultReadProcessTable = () => {
  try {
    return spawnSync('ps', ['-Ao', 'pid=,ppid='], {encoding: 'utf8', timeout: 2000}).stdout ?? '';
  } catch {
    return '';
  }
};

/**
 * @param {{spawnImpl?: Function, killImpl?: Function, tempParent?: string}} [deps]
 *   spawnImpl 默认真实 child_process.spawn,测试可注入假实现避免真的起渲染进程。
 *   killImpl 同理默认真实 process.kill,单测用它断言"取消时确实尝试杀了整个
 *   进程组"而不依赖真实进程组行为——生产代码不要传这个参数。
 *   tempParent 是 fetch-audio 下载中转目录的父目录,同样只为单测可观测。
 */
export const createJobManager =({
  spawnImpl = spawnActual,
  killImpl = process.kill,
  tempParent = os.tmpdir(),
  readProcessTable = defaultReadProcessTable,
  now = () => Date.now(),
  stallTimeoutMs = STALL_TIMEOUT_MS,
  stallCheckIntervalMs = STALL_CHECK_INTERVAL_MS,
} = {}) => {
  /** @type {Map<string, object>} */
  const jobs = new Map();
  let runningJobId = null;

  /** 记录一条事件并即时推给所有 SSE 订阅者。两种进度来源共用同一个出口。 */
  const emit = (job, event) => {
    job.lastActivityAt = now();
    job.events.push(event);
    const chunk = `data: ${JSON.stringify(event)}\n\n`;
    for (const listener of job.listeners) listener(chunk);
  };

  /**
   * 挂上进度来源。fd 3(NDJSON)与 yt-dlp stdout(文本百分比)在这里被抹平成
   * 同一份事件形状,前端不需要知道进度是从哪来的。
   * 整段都必须静默容错:进度只是旁路信息,读不到/读坏了不该把任务管理带崩。
   */
  const attachProgress = (job, child, progressSource) => {
    const stream = progressSource === 'ytdlp-stdout' ? child.stdio?.[1] : child.stdio?.[3];
    if (!stream) return null;
    const toEvent = progressSource === 'ytdlp-stdout'
      ? parseYtDlpProgress
      : (line) => {
        try {
          return JSON.parse(line);
        } catch {
          // 单行解析失败直接跳过,不能让一行坏数据打断后续事件。
          return null;
        }
      };
    // yt-dlp 一秒能刷几十行进度,同一个百分比重复推没有信息量,只会把 events
    // 数组和 SSE 撑大;去重后前端看到的仍是单调递增的百分比。
    let lastPercent = null;
    try {
      const rl = readline.createInterface({input: stream});
      rl.on('line', (line) => {
        const event = toEvent(line);
        if (!event) return;
        if (event.kind === 'progress' && progressSource === 'ytdlp-stdout') {
          if (event.percent === lastPercent) return;
          lastPercent = event.percent;
        }
        emit(job, event);
      });
      rl.on('error', () => {});
      stream.on?.('error', () => {});
      return rl;
    } catch {
      return null;
    }
  };

  const createJob = ({kind, folder, options}) => {
    if (runningJobId !== null) {
      return {error: 'busy'};
    }
    // 校验失败在这里往外抛 JobValidationError,交给 HTTP 层捕获转 400。
    const spec = buildJobSpec({kind, folder, options, tempParent});

    const id = crypto.randomUUID();
    // detached: true 让子进程成为一个新进程组的组长。渲染/出图任务会再往下拉起
    // remotion/chromium 等孙子进程,child.kill() 只能杀直接子进程,孙子进程(尤其
    // 是渲染用的 chromium)会变成孤儿继续占着资源跑;取消时改用
    // process.kill(-child.pid, 'SIGTERM')(负 pid 表示对整个进程组发信号)才能
    // 把这一整棵进程树斩草除根。yt-dlp 同理(它会拉起 ffmpeg 做转码)。
    const child = spawnImpl(spec.command, spec.args, {
      stdio: spec.stdio,
      detached: true,
      env: spec.env,
    });

    const job = {
      id, kind, folder, status: 'running', exitCode: null, events: [], child,
      cancelled: false, listeners: new Set(), killTimer: null,
      tempDir: spec.tempDir ?? null,
      // 停滞检测用:最后一次收到事件的时间
      lastActivityAt: Date.now(),
      stallTimer: null,
    };
    jobs.set(id, job);
    runningJobId = id;

    // 停滞看门狗:只给 fetch-audio 挂。yt-dlp 下载时每秒都在刷进度,长时间一条
    // 都没有就是卡死了;而 whisper 识别本来就会安静好几分钟,给它挂必然误杀。
    if (spec.progressSource === 'ytdlp-stdout') {
      job.stallTimer = setInterval(() => {
        if (job.status !== 'running') return;
        if (now() - job.lastActivityAt < stallTimeoutMs) return;
        emit(job, {kind: 'error', text: '下载长时间没有进展,已中止(网络或代理可能断了)'});
        cancelJob(job.id);
      }, stallCheckIntervalMs);
      job.stallTimer.unref?.();
    }

    // 没被当作进度来源的那几路输出不暴露给前端(契约没有要求),但必须消费掉,
    // 否则子进程写满 pipe 缓冲区之后会被阻塞挂起。
    if (spec.progressSource !== 'ytdlp-stdout') child.stdio[1]?.resume?.();
    // stderr 不推给前端(契约没要求),但也不能全丢:yt-dlp 的真实报错
    // (Video unavailable / Sign in to confirm / 地区限制)全在这里,丢掉之后
    // 用户只会看到一句放之四海皆准的"下载失败",完全无从排查。留最后几行。
    const stderrTail = [];
    child.stdio[2]?.setEncoding?.('utf8');
    child.stdio[2]?.on?.('data', (chunk) => {
      for (const line of String(chunk).split('\n')) {
        const text = line.trim();
        if (text) stderrTail.push(text);
      }
      if (stderrTail.length > STDERR_TAIL_LINES) stderrTail.splice(0, stderrTail.length - STDERR_TAIL_LINES);
    });
    child.stdio[2]?.resume?.();
    job.stderrTail = stderrTail;

    const rl = attachProgress(job, child, spec.progressSource);

    // spawn 失败(EAGAIN/EMFILE 等)时 ChildProcess 发 'error' 而**不发** 'exit'。
    // 没有监听器时 EventEmitter 会直接 throw,在 server 里就是 uncaughtException;
    // 就算不崩,不发 exit 也意味着 runningJobId 永远不释放,此后所有任务都 409。
    child.on('error', () => {
      if (job.status !== 'running') return;
      job.status = 'failed';
      job.exitCode = null;
      rl?.close();
      // 命令根本没起来(比如没装 yt-dlp),善后逻辑仍要跑一遍,否则临时目录会漏。
      runFinalize(job, spec, null, {spawnFailed: true});
      finish(job);
    });

    child.on('exit', (code) => {
      rl?.close();
      // finalize 决定"退出码 0 但收尾失败"这种情况(比如下载成功却装不进 audio/),
      // 必须在定 status 之前跑完,而且它自己保证不抛。
      const ok = runFinalize(job, spec, code, {spawnFailed: false});
      job.status = job.cancelled ? 'cancelled' : ok ? 'done' : 'failed';
      job.exitCode = code;
      // 取消过的任务**不清**兜底定时器:退出的只是那个薄壳,孙进程可能还活着,
      // 那一刀必须照常补。只有正常结束的任务才需要撤掉定时器。
      if (job.killTimer !== null && !job.cancelled) {
        clearTimeout(job.killTimer);
        job.killTimer = null;
      }
      finish(job);
    });

    return {id};
  };

  /** 跑任务自带的收尾钩子(安装下载结果、清临时目录),返回任务是否算成功。 */
  const runFinalize = (job, spec, code, {spawnFailed = false} = {}) => {
    if (!spec.finalize) return code === 0;
    let outcome;
    try {
      outcome = spec.finalize(code, {stderrTail: job.stderrTail ?? [], spawnFailed});
    } catch {
      // finalize 是在子进程回调里跑的,漏出去就是 uncaughtException 直接崩 server。
      return false;
    }
    for (const event of outcome.events ?? []) emit(job, event);
    return outcome.ok === true;
  };

  /** 广播 end 帧、清监听器、释放并发锁。exit 与 error 两条收尾路径共用。 */
  const finish = (job) => {
    if (job.stallTimer !== null) {
      clearInterval(job.stallTimer);
      job.stallTimer = null;
    }
    const endChunk = `event: end\ndata: ${JSON.stringify({status: job.status, exitCode: job.exitCode})}\n\n`;
    for (const listener of job.listeners) listener(endChunk);
    job.listeners.clear();
    if (runningJobId === job.id) runningJobId = null;
    pruneJobs();
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


/** 向整个进程组发信号。负 pid 配合 detached: true 覆盖同组的孙进程。 */
  const signalGroup = (job, signal) => {
    try {
      killImpl(-job.child.pid, signal);
    } catch {
      // 进程可能已经退出,或权限问题——取消语义上已经"发起"了,不该报 500。
    }
  };

  /** 删掉 fetch-audio 的下载中转目录。没有就什么都不做。 */
  const removeTempDir = (job) => {
    if (!job.tempDir) return;
    try {
      fs.rmSync(job.tempDir, {recursive: true, force: true});
    } catch {
      // 删不掉就算了,系统临时目录自己会回收
    }
    job.tempDir = null;
  };

  /** 只保留最近的若干条任务记录,避免长时间开着的 server 无限攒 events。 */
  const pruneJobs = () => {
    if (jobs.size <= MAX_JOBS_KEPT) return;
    for (const [id, job] of jobs) {
      if (jobs.size <= MAX_JOBS_KEPT) break;
      // 只清已结束的,正在跑的绝不能动
      if (job.status !== 'running') jobs.delete(id);
    }
  };

  /** 逐个杀掉快照里的后代。它们可能已经退出,ESRCH 一律忽略。 */
  const killSnapshot = (job, signal) => {
    for (const pid of job.descendants ?? []) {
      try {
        killImpl(pid, signal);
      } catch {
        // 已经退出了,正常
      }
    }
  };

  const cancelJob = (id) => {
    const job = jobs.get(id);
    if (!job) return false;
    if (job.status !== 'running') return false;
    job.cancelled = true;
    // 趁进程树还完整先快照:render.mjs 一死,chromium 就被 reparent 到 launchd,
    // 从我们的 pid 再也走不到它们。
    job.descendants = listDescendants(job.child.pid, readProcessTable);
    signalGroup(job, 'SIGTERM');
    // 后代**立刻**杀,不给宽限期。SIGTERM 的宽限是留给我们自己那个 tsuzuri.mjs
    // 壳的(它可能要收尾),而 chromium 没有任何要 flush 的状态;更要命的是实测
    // 发现等 3 秒之后那批 pid 已经全部 ESRCH、却又有 13 个新的 chromium 在跑,
    // 快照就此失效。只有"快照完立刻动手"才抓得住。
    killSnapshot(job, 'SIGKILL');
    // SIGTERM 是"请你退出",render.mjs 与 chromium 扛住它是实测出来的常态。
    //
    // 兜底**不能**以"直接子进程是否退出"为条件:直接子进程只是个很薄的
    // tsuzuri.mjs 壳,SIGTERM 一到立刻就死,真正吃 CPU 的是它下面的 render.mjs
    // 和十几个 chromium。以前这里判 `job.status === 'running'`,而壳一死状态就
    // 变成 cancelled,兜底直接被跳过——实测点了取消之后 14 个进程一个没少,
    // render.mjs 还在 33% CPU 上跑。所以这里无条件对整个进程组补一刀。
    // 组里已经空了的话 kill 会抛 ESRCH,被 signalGroup 吞掉,无害。
    if (job.killTimer === null) {
      job.killTimer = setTimeout(() => {
        job.killTimer = null;
        signalGroup(job, 'SIGKILL');
        killSnapshot(job, 'SIGKILL');
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
      // Ctrl+C 之后进程马上就走,没有等它体面退出的余地;而 SIGTERM 单独发
      // 挡不住 render.mjs 与 chromium(实测)。两刀一起发,SIGKILL 保证不留孤儿。
      job.descendants = listDescendants(job.child.pid, readProcessTable);
      signalGroup(job, 'SIGTERM');
      signalGroup(job, 'SIGKILL');
      killSnapshot(job, 'SIGKILL');
      // Ctrl+C 之后进程立刻就走,'exit' 回调没机会跑,finalize 里的 rmSync 也就
      // 不会执行 —— 下载中途关掉 server 会把 /tmp/tsuzuri-fetch-* 留在磁盘上。
      // 这里同步删掉,是这条路径上唯一的机会。
      removeTempDir(job);
    }
  };

  /** 仅供测试观测 SSE 监听者是否被正确清理,生产代码不要用。 */
  const _debugListenerCount = (id) => jobs.get(id)?.listeners.size ?? 0;

  // 写文件操作必须以服务端的真实任务状态为准，不能信任浏览器传来的 busy。
  const hasRunningJob = () => runningJobId !== null;

  // 页面刷新/关标签页会丢掉前端内存里的 jobId,但服务端任务还在跑——前端需要
  // 一个"当前有没有任务、是谁的"的探测入口,才能重新 attach 上 SSE。
  const getRunningJob = () => {
    if (runningJobId === null) return null;
    const job = jobs.get(runningJobId);
    return {id: job.id, kind: job.kind, folder: job.folder};
  };

  return {createJob, getJob, subscribeEvents, cancelJob, killAll, hasRunningJob, getRunningJob, _debugListenerCount};
};
