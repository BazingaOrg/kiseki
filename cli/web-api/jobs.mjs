/**
 * 任务执行:把网页发来的结构化选项组装成一条"命令 + 参数 + 进度来源"的任务描述,
 * 起子进程执行,并把进度事件(契约一的形状)收集起来供 HTTP 层轮询或 SSE 推送.
 *
 * 任务有两种形态,差异全部收敛在 buildJobSpec 里,对前端完全透明:
 * - `progressSource: 'fd3'` —— 跑 tsuzuri CLI,读 fd 3 上的 NDJSON(term.mjs 产出).
 * - `progressSource: 'ytdlp-stdout'` —— 直接跑 yt-dlp,它不认识 fd 3,进度写在
 *   stdout 上的 `[download]  42.3% of ...`,由本模块翻译成同一份事件形状.
 *
 * 本模块不碰 http,argv/spec 组装尽量做成纯函数,方便单测直接调用.
 */
import {spawn as spawnActual, spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import readline from 'node:readline';

import {buildJobSpec, parseYtDlpProgress} from './job-spec.mjs';
import {createTaskLeaseManager, ProjectBusyError} from '../task-lease.mjs';
import {executorIdentity, executorLiveness, freezeExecutorTree, resumeFrozenExecutorTree, signalExecutorGroupOrRoot, signalExecutorTree, terminateExecutorTree} from '../runtime-lifecycle.mjs';

export {JobValidationError, buildJobArgv, buildJobEnv, buildJobInvocation} from '../job-argv.mjs';

/** 失败时回带的 stderr 行数上限,够定位又不至于把整屏日志灌给前端. */
const STDERR_TAIL_LINES = 5;
export {buildJobSpec, parseYtDlpProgress, YTDLP_PROGRESS_LABEL} from './job-spec.mjs';

/**
 * 取消后等进程组体面退出的宽限期,超时就 SIGKILL.
 * 取 3 秒而不是更长:取消的语义是"现在就停",而这期间十几个 chromium 在满负荷跑.
 */
const FORCE_KILL_AFTER_MS = 3000;

/**
 * fetch-audio 的停滞阈值.yt-dlp 下载期间每秒都在刷进度,超过这么久一条都没有,
 * 基本就是卡死了(代理挂了但 TCP 不断是最常见的形态).不加这个,一个永远到不了
 * 100% 的下载会一直占着并发锁,用户不点取消就再也起不了任何任务.
 *
 * **只对 fetch-audio 生效**:whisper 识别会先安静好几分钟再一次性吐结果,
 * 对它做停滞检测必然误杀.
 */
const STALL_TIMEOUT_MS = 120_000;

/** 停滞检查的轮询间隔. */
const STALL_CHECK_INTERVAL_MS = 15_000;

/** 内存里最多保留多少条任务记录.本地单人工具,留最近的够回看就行. */
const MAX_JOBS_KEPT = 20;

  /**
 * 列出某个 pid 的全部后代(含自身之外的各级子孙).
 *
 * 为什么不能只靠进程组:puppeteer/remotion 起 chromium 时自己也用了 detached,
 * 浏览器进城在**它自己的进程组**里,`kill(-pgid)` 够不到 —— 实测取消一次渲染,
 * render.mjs 死了但 13 个 chromium 全部存活(闲置不吃 CPU,但也永远不退).
 *
 * 必须在树还完整的时候快照:一旦中间的 render.mjs 被杀,chromium 会被 reparent
 * 到 launchd/init,从我们的 pid 再也走不到它们.
 */
export const listDescendants = (rootPid, readTable = defaultReadProcessTable) => {
  const table = readTable() ?? '';
  const childrenOf = new Map();
  for (const line of table.split('\n')) {
    const match = /^\s*(\d+)\s+(\d+)(?:\s+.*)?$/.exec(line);
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
    // lstart 是 pid 复用防护的一部分.KILL 前必须重新确认还是同一个进程,
    // 不能把三秒前的 pid 快照直接当作永远有效.
    const result = spawnSync('ps', ['-Ao', 'pid=,ppid=,lstart='], {encoding: 'utf8', timeout: 2000});
    return result.error || result.signal ? null : result.stdout ?? '';
  } catch {
    return null;
  }
};

const defaultTaskkill = (pid, force) => new Promise((resolve, reject) => {
  const args = force ? ['/PID', String(pid), '/F', '/T'] : ['/PID', String(pid), '/T'];
  const child = spawnActual('taskkill', args, {
    stdio: 'ignore', windowsHide: true,
  });
  child.once('error', reject);
  child.once('close', (code) => code === 0 ? resolve() : reject(new Error(`退出码 ${code}`)));
});

/**
 * @param {{spawnImpl?: Function, killImpl?: Function, tempParent?: string}} [deps]
 *   spawnImpl 默认真实 child_process.spawn,测试可注入假实现避免真的起渲染进程.
 *   killImpl 同理默认真实 process.kill,单测用它断言"取消时确实尝试杀了整个
 *   进程组"而不依赖真实进程组行为——生产代码不要传这个参数.
 *   tempParent 是 fetch-audio 下载中转目录的父目录,同样只为单测可观测.
 */
export const createJobManager =({
  spawnImpl = spawnActual,
  killImpl = process.kill,
  tempParent = os.tmpdir(),
  readProcessTable = defaultReadProcessTable,
  now = () => Date.now(),
  stallTimeoutMs = STALL_TIMEOUT_MS,
  stallCheckIntervalMs = STALL_CHECK_INTERVAL_MS,
  forceKillAfterMs = FORCE_KILL_AFTER_MS,
  platform = process.platform,
  taskkillImpl = defaultTaskkill,
  executorLivenessImpl = executorLiveness,
  leaseManager = createTaskLeaseManager({terminateExecutor: terminateExecutorTree, executorLiveness}),
} = {}) => {
  /** @type {Map<string, object>} */
  const jobs = new Map();
  let runningJobId = null;

  /**
   * 记录一条事件并即时推给所有 SSE 订阅者.progress 是可变快照,历史只留最新
   * 一条;其余事件是可审阅的任务语义,必须完整保留并按原顺序重放.
   */
  const emit = (job, event) => {
    job.lastActivityAt = now();
    if (event.kind === 'progress') {
      job.events = [...job.events.filter((item) => item.kind !== 'progress'), event];
    } else {
      job.events.push(event);
    }
    const chunk = `data: ${JSON.stringify(event)}\n\n`;
    for (const listener of job.listeners) listener(chunk);
  };

  /**
   * 挂上进度来源.fd 3(NDJSON)与 yt-dlp stdout(文本百分比)在这里被抹平成
   * 同一份事件形状,前端不需要知道进度是从哪来的.
   * 整段都必须静默容错:进度只是旁路信息,读不到/读坏了不该把任务管理带崩.
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
          // 单行解析失败直接跳过,不能让一行坏数据打断后续事件.
          return null;
        }
      };
    // yt-dlp 一秒能刷几十行进度,同一个百分比重复推没有信息量,只会把 events
    // 数组和 SSE 撑大;去重后前端看到的仍是单调递增的百分比.
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
    // Lease 先于 spawn:第二个 web server 即使内存里没有 runningJobId,也不能
    // 在同一个项目上并发写入.临时下载目录必须位于 taskRoot,不碰系统 /tmp.
    let lease;
    let spec;
    try {
      // Validate/specify outputs before claiming so two projects cannot write the
      // same explicit -o destination. fetch's staging is rebuilt under taskRoot.
      spec = buildJobSpec({kind, folder, options, tempParent});
      lease = leaseManager.acquire({kind, resources: [folder], outputPaths: spec.outputPaths});
      if (kind === 'fetch-audio') {
        fs.rmSync(spec.tempDir, {recursive: true, force: true});
        spec = buildJobSpec({kind, folder, options, tempParent: lease.taskRoot});
      }
    } catch (error) {
      if (lease) leaseManager.release(lease);
      if (error instanceof ProjectBusyError) return {error: 'busy'};
      throw error;
    }
    const id = lease.id;
    // detached 使 CLI 脱离 Web server 的终端组;渲染/下载还会拉起 chromium、
    // ffmpeg 等后代.终止路径必须快照并逐个核验 identity,不能把负 PID
    // 进程组信号当作跨平台、跨子树的可靠树终止.
    let child;
    try {
      leaseManager.markSpawnIntent(lease);
      child = spawnImpl(spec.command, spec.args, {
        stdio: spec.stdio,
        detached: true,
        env: {
          ...spec.env,
          TSUZURI_LEASE_TASK_ID: lease.id,
          TSUZURI_LEASE_TASK_TOKEN: lease.token,
          TSUZURI_LEASE_TASK_ROOT: lease.taskRoot,
        },
      });
    } catch (error) {
      leaseManager.release(lease);
      throw error;
    }

    // Probe the identity exactly once. registerExecutor may return the value
    // already persisted by the child; job termination must use that canonical
    // pid/start pair, never a second adjacent ps lookup that can drift.
    const spawnedExecutor = executorIdentity(child.pid);
    const job = {
      id, kind, folder, spec, status: 'running', exitCode: null, events: [], child, lease,
      cancelled: false, listeners: new Set(), killTimer: null,
      // 停滞检测用:最后一次收到事件的时间
      lastActivityAt: Date.now(),
      stallTimer: null,
      exited: false, closed: false, finalized: false, descendants: [], executor: spawnedExecutor,
      terminationPromise: null, resolveTermination: null, terminationSettled: false,
    };
    job.closePromise = new Promise((resolve) => { job.resolveClose = resolve; });
    jobs.set(id, job);
    runningJobId = id;
    let executorRegistered = false;

    // 停滞看门狗:只给 fetch-audio 挂.yt-dlp 下载时每秒都在刷进度,长时间一条
    // 都没有就是卡死了;而 whisper 识别本来就会安静好几分钟,给它挂必然误杀.
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
    // 否则子进程写满 pipe 缓冲区之后会被阻塞挂起.
    if (spec.progressSource !== 'ytdlp-stdout') child.stdio[1]?.resume?.();
    // stderr 不推给前端(契约没要求),但也不能全丢:yt-dlp 的真实报错
    // (Video unavailable / Sign in to confirm / 地区限制)全在这里,丢掉之后
    // 用户只会看到一句放之四海皆准的"下载失败",完全无从排查.留最后几行.
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

    // spawn 失败(EAGAIN/EMFILE 等)时 ChildProcess 发 'error' 而**不发** 'exit'.
    // 没有监听器时 EventEmitter 会直接 throw,在 server 里就是 uncaughtException;
    // 就算不崩,不发 exit 也意味着 runningJobId 永远不释放,此后所有任务都 409.
    // Node leaves pid undefined when spawn failed before creating a process.
    // This is the only startup path that can safely release immediately.
    const finishSpawnFailed = () => {
      if (job.finalized) return;
      job.closed = true;
      job.status = 'failed';
      job.exitCode = null;
      rl?.close();
      runFinalize(job, spec, null, {spawnFailed: true});
      finish(job);
      job.resolveClose();
    };

    const failUnregisteredChild = () => {
      if (job.finalized || job.status !== 'running') return;
      // A positive pid can already be a real process even when its start time
      // probe or durable registration failed. Keep the lease fail-closed and
      // use the normal termination path only when identity permits it.
      job.terminalFailure = true;
      void beginTermination(job, spec);
    };

    child.on('error', () => {
      if (!executorRegistered) {
        failUnregisteredChild();
        return;
      }
      if (job.status === 'stopping') {
        job.closed = true;
        maybeCompleteTermination(job, spec, null);
        return;
      }
      if (job.status !== 'running') return;
      job.terminalFailure = true;
      void beginTermination(job, spec);
    });

    child.on('exit', (code) => {
      // exit 只说明可执行体结束;stdio 仍可能把尾部数据刷进 pipe.终态以 close
      // 为准,确保所有 fd 关闭且 child 已被 reap.
      job.exited = true;
      job.exitCode = code;
    });

    child.on('close', (code) => {
      if (!executorRegistered) {
        job.closed = true;
        failUnregisteredChild();
        job.resolveClose();
        return;
      }
      if (job.closed) return;
      job.closed = true;
      rl?.close();
      if (job.status === 'stopping') {
        // `close` only reaps the direct child. Detached render descendants can
        // still be alive, so cancellation remains pending until their identity
        // snapshots are proven absent.
        maybeCompleteTermination(job, spec, job.exitCode ?? code);
        job.resolveClose();
        return;
      }
      // finalize 决定"退出码 0 但收尾失败"这种情况(比如下载成功却装不进 audio/),
      // 必须在定 status 之前跑完,而且它自己保证不抛.
      const finalCode = job.exitCode ?? code;
      const ok = runFinalize(job, spec, finalCode, {spawnFailed: false});
      job.status = job.cancelled ? 'cancelled' : ok ? 'done' : 'failed';
      job.exitCode = finalCode;
      finish(job);
      job.resolveClose();
    });

    if (!Number.isInteger(child.pid) || child.pid <= 0) {
      finishSpawnFailed();
      return {id};
    }

    // The CLI may authenticate the inherited lease and record its own PID
    // before this parent gets scheduled again. registerExecutor is idempotent
    // for that exact identity.
    try {
      const canonicalExecutor = leaseManager.registerExecutor(lease, spawnedExecutor);
      if (!canonicalExecutor || !Number.isInteger(canonicalExecutor.pid) || typeof canonicalExecutor.start !== 'string' || !canonicalExecutor.start) {
        throw new Error('task executor canonical identity 无效');
      }
      job.executor = canonicalExecutor;
      executorRegistered = true;
    } catch (error) {
      // Registration can fail after spawn created a real process. The
      // spawned identity is still the best available evidence; if it is
      // unknown, beginTermination fails closed and retains the lease.
      job.terminalFailure = true;
      void beginTermination(job, spec);
      throw error;
    }

    return {id};
  };

  /** 跑任务自带的收尾钩子(安装下载结果、清临时目录),返回任务是否算成功. */
  const runFinalize = (job, spec, code, {spawnFailed = false} = {}) => {
    if (!spec.finalize) return code === 0;
    let outcome;
    try {
      outcome = spec.finalize(code, {
        stderrTail: job.stderrTail ?? [], spawnFailed,
        task: {lease: job.lease, manager: leaseManager},
      });
    } catch {
      // finalize 是在子进程回调里跑的,漏出去就是 uncaughtException 直接崩 server.
      return false;
    }
    for (const event of outcome.events ?? []) {
      // A success event is terminal-facing: hold it until the durable lease is
      // actually released, otherwise the next request can immediately learn
      // that the project is still busy after the UI was told it succeeded.
      if (event.kind === 'success') {
        job.pendingSuccessEvents = [...(job.pendingSuccessEvents ?? []), event];
      } else {
        emit(job, event);
      }
    }
    return outcome.ok === true;
  };

  /** 广播 end 帧、清监听器、释放并发锁.exit 与 error 两条收尾路径共用. */
  const finish = (job, {releaseLease = true} = {}) => {
    if (job.finalized) return;
    job.finalized = true;
    if (job.stallTimer !== null) {
      clearInterval(job.stallTimer);
      job.stallTimer = null;
    }
    if (job.killTimer !== null) {
      clearTimeout(job.killTimer);
      job.killTimer = null;
    }
    if (job.terminationPoll !== null && job.terminationPoll !== undefined) {
      clearTimeout(job.terminationPoll);
      job.terminationPoll = null;
    }
    if (releaseLease) {
      // A false/throwing release means durable ownership was not proven gone.
      // Never advertise success and let the next writer discover the busy lease.
      let released = false;
      try { released = leaseManager.release(job.lease) === true; } catch { /* fail closed below */ }
      if (!released) {
        job.status = 'failed';
        job.exitCode = null;
        emit(job, {kind: 'error', text: '任务 lease 释放失败,已保留占用以防止并发写入'});
      }
    }
    if (job.status === 'done') {
      for (const event of job.pendingSuccessEvents ?? []) emit(job, event);
    }
    job.pendingSuccessEvents = [];
    const endChunk = `event: end\ndata: ${JSON.stringify({status: job.status, exitCode: job.exitCode})}\n\n`;
    for (const listener of job.listeners) listener(endChunk);
    job.listeners.clear();
    // Finalize (including fetch-audio temp cleanup) runs before finish. Release
    // verifies the manifest token, so an old callback cannot delete another task.
    // An unconfirmed tree deliberately retains its durable claim. Releasing it
    // would allow a new process to write into a project still owned by a stray
    // chromium/ffmpeg descendant.
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
    // 迟到的订阅者也要能补上已经发生过的事件,先把缓冲区里已有的逐条重放一遍.
    for (const event of job.events) listener(`data: ${JSON.stringify(event)}\n\n`);
    if (job.status !== 'running' && job.status !== 'stopping') {
      listener(`event: end\ndata: ${JSON.stringify({status: job.status, exitCode: job.exitCode})}\n\n`);
      return () => {};
    }
    job.listeners.add(listener);
    // 客户端断开连接时 HTTP 层要调用这个 unsubscribe,否则 job.listeners 会一直
    // 攒着已经没人接收的回调,直到任务结束才清空——短任务还好,长任务加上频繁的
    // 客户端断线重连会造成明显的内存泄漏.
    return () => job.listeners.delete(listener);
  };

  /** 只保留最近的若干条任务记录,避免长时间开着的 server 无限攒 events. */
  const pruneJobs = () => {
    if (jobs.size <= MAX_JOBS_KEPT) return;
    for (const [id, job] of jobs) {
      if (jobs.size <= MAX_JOBS_KEPT) break;
      // 只清已结束的,正在跑的绝不能动
      if (job.status !== 'running' && job.status !== 'stopping') jobs.delete(id);
    }
  };

  const mergeDescendants = (previous, current) => {
    const merged = new Map();
    for (const descendant of [...previous, ...current]) {
      if (!Number.isInteger(descendant?.pid) || descendant.pid <= 0 || typeof descendant.start !== 'string' || !descendant.start) continue;
      merged.set(`${descendant.pid}:${descendant.start}`, descendant);
    }
    return [...merged.values()];
  };

  const readDescendantSnapshot = (job) => {
    if (platform === 'win32') {
      // taskkill owns tree discovery on Windows. ps snapshots are neither
      // available nor trustworthy there; close + platform liveness is proof.
      return {known: true, descendants: []};
    }
    const table = readProcessTable();
    if (typeof table !== 'string') return {known: false, descendants: []};
    const identities = new Map();
    for (const line of table.split('\n')) {
      const match = /^\s*(\d+)\s+(\d+)(?:\s+(.*\S))?\s*$/.exec(line);
      if (match?.[3]) identities.set(Number(match[1]), match[3]);
    }
    const observed = listDescendants(job.child.pid, () => table)
      .map((pid) => ({pid, start: identities.get(pid) ?? null}));
    if (observed.some((identity) => !identity.start)) return {known: false, descendants: []};
    return {known: true, descendants: observed};
  };

  const snapshotDescendants = (job, {merge = true} = {}) => {
    const snapshot = readDescendantSnapshot(job);
    if (!snapshot.known) {
      job.snapshotUnknown = true;
      return false;
    }
    const observed = snapshot.descendants;
    job.descendants = merge ? mergeDescendants(job.descendants ?? [], observed) : observed;
    job.snapshotUnknown = false;
    return true;
  };

  const snapshotLiveness = (job, executor) => {
    if (platform === 'win32') return executorLivenessImpl(executor, {platform});
    // A missing start identity is never proof that a PID disappeared: both
    // values could be undefined after a failed/partial process-table read.
    if (!executor || !Number.isInteger(executor.pid) || executor.pid <= 0 || typeof executor.start !== 'string' || !executor.start) {
      return 'unknown';
    }
    const table = readProcessTable();
    if (typeof table !== 'string') return 'unknown';
    const live = new Map();
    for (const line of table.split('\n')) {
      const match = /^\s*(\d+)\s+\d+(?:\s+(.*\S))?\s*$/.exec(line);
      if (match?.[2]) live.set(Number(match[1]), match[2]);
    }
    return live.get(executor.pid) === executor.start ? 'alive' : 'dead';
  };

  /** True only when direct-child close and every captured identity is absent. */
  const snapshotTreeAbsent = (job) => {
    if (!job.closed || job.snapshotUnknown) return false;
    return snapshotLiveness(job, job.executor) === 'dead'
      && (job.descendants ?? []).every((descendant) => snapshotLiveness(job, descendant) === 'dead');
  };

  const signalSnapshotTree = (job, signal) => signalExecutorTree(job.executor, job.descendants, signal, {
    killImpl, platform, liveness: (executor) => snapshotLiveness(job, executor),
  });

  const signalGroupThenSnapshot = (job, signal) => {
    const root = snapshotLiveness(job, job.executor);
    if (root === 'unknown') return false;
    if (root === 'alive' && !signalExecutorGroupOrRoot(job.executor, signal, {
      killImpl, platform, liveness: (executor) => snapshotLiveness(job, executor),
    })) return false;
    // The group/root signal must happen before this fresh sample, otherwise a
    // still-running executor can create a detached child between the two.
    if (!snapshotDescendants(job)) return false;
    return signalSnapshotTree(job, signal) || snapshotTreeAbsent(job);
  };

  const freezeThenSignal = (job, signal) => {
    if (signal === 'SIGKILL' && snapshotLiveness(job, job.executor) === 'dead') {
      // TERM may reap the direct executor before the force timer. Its verified
      // descendant union remains authoritative, so drain it directly and let
      // the normal poll wait for both close and identity absence.
      return signalSnapshotTree(job, signal) || snapshotTreeAbsent(job);
    }
    const frozen = freezeExecutorTree(job.executor, {
      killImpl,
      platform,
      liveness: (executor) => snapshotLiveness(job, executor),
      snapshot: () => readDescendantSnapshot(job),
    });
    job.descendants = mergeDescendants(job.descendants ?? [], frozen.descendants);
    if (!frozen.confirmed) {
      resumeFrozenExecutorTree(job.executor, frozen.frozen, {
        killImpl, platform, liveness: (executor) => snapshotLiveness(job, executor),
      });
      return false;
    }
    // All known writers are stopped, so TERM cannot race a fork/reparent.
    const signalled = signalExecutorGroupOrRoot(job.executor, signal, {
      killImpl, platform, liveness: (executor) => snapshotLiveness(job, executor),
    }) && signalSnapshotTree(job, signal);
    resumeFrozenExecutorTree(job.executor, job.descendants, {
      killImpl, platform, liveness: (executor) => snapshotLiveness(job, executor),
    });
    return signalled;
  };

  const terminateWindowsTree = async (job, force = false) => {
    const executor = job.executor;
    if (!executor || !Number.isInteger(executor.pid) || executor.pid <= 0 || typeof executor.start !== 'string' || !executor.start) {
      return false;
    }
    if (executorLivenessImpl(executor, {platform}) !== 'alive') return false;
    try {
      await taskkillImpl(executor.pid, force);
      return true;
    } catch (error) {
      emit(job, {kind: 'error', text: `taskkill ${force ? '强制' : '终止'}进程树失败: ${error.message}`});
      return false;
    }
  };

  const settleTerminationFailure = (job, reason) => {
    if (job.terminationSettled) return;
    job.terminationSettled = true;
    job.status = 'failed';
    job.exitCode = null;
    emit(job, {kind: 'error', text: `${reason};任务 lease 已保留,请人工确认残留进程后重启清理`});
    finish(job, {releaseLease: false});
    job.resolveTermination?.({clean: false});
  };

  const completeTermination = (job, spec, code) => {
    if (job.terminationSettled) return;
    if (!snapshotTreeAbsent(job)) return;
    job.terminationSettled = true;
    if (job.terminalFailure) {
      // A post-spawn registration failure remains failed even if the cleanup
      // tree exits cleanly; a later close callback must not regress it.
      job.status = 'failed';
      job.exitCode = null;
      runFinalize(job, spec, null, {spawnFailed: true});
      finish(job);
      job.resolveTermination?.({clean: true});
      return;
    }
    job.status = 'cancelled';
    job.exitCode = code;
    runFinalize(job, spec, code, {spawnFailed: false});
    finish(job);
    job.resolveTermination?.({clean: true});
  };

  const maybeCompleteTermination = (job, spec, code) => completeTermination(job, spec, code);

  const pollTermination = (job, spec) => {
    if (job.terminationSettled) return;
    if (job.terminationPoll !== null && job.terminationPoll !== undefined) {
      clearTimeout(job.terminationPoll);
      job.terminationPoll = null;
    }
    // While the root still exists, keep merging newly observed descendants.
    // Once reparented, an identity remains in the union until proven absent.
    if (snapshotLiveness(job, job.executor) === 'alive') snapshotDescendants(job);
    maybeCompleteTermination(job, spec, job.exitCode);
    if (job.terminationSettled) return;
    if (now() >= job.terminationDeadlineAt) {
      settleTerminationFailure(job, '终止期限内无法确认 child close 与进程树退出');
      return;
    }
    job.terminationPoll = setTimeout(() => pollTermination(job, spec), 50);
    job.terminationPoll.unref?.();
  };

  const beginTermination = (job, spec = null) => {
    if (job.terminationPromise) return job.terminationPromise;
    if (job.status !== 'running') return Promise.resolve({clean: job.status !== 'failed'});
    job.status = 'stopping';
    job.cancelled = true;
    job.terminationPromise = new Promise((resolve) => { job.resolveTermination = resolve; });
    job.terminationDeadlineAt = now() + forceKillAfterMs * 2;
    if (platform === 'win32') {
      void terminateWindowsTree(job).then((ok) => {
        if (!ok) settleTerminationFailure(job, '终止进程树失败');
        else pollTermination(job, spec);
      });
    } else {
      // Freeze before TERM so a detached child cannot fork and reparent between
      // snapshotting and its parent being terminated.
      if (!freezeThenSignal(job, 'SIGTERM')) settleTerminationFailure(job, '无法证明进程树身份以发送终止信号');
      else pollTermination(job, spec);
    }
    job.killTimer = setTimeout(() => {
      job.killTimer = null;
      if (platform === 'win32') {
        void terminateWindowsTree(job, true).then((ok) => {
          if (!ok) return settleTerminationFailure(job, '强制终止进程树失败');
          pollTermination(job, spec);
        });
      } else {
        if (!freezeThenSignal(job, 'SIGKILL') && !snapshotTreeAbsent(job)) {
          settleTerminationFailure(job, '无法证明剩余进程组身份或进程树已退出');
          return;
        }
        pollTermination(job, spec);
      }
    }, forceKillAfterMs);
    job.killTimer.unref?.();
    return job.terminationPromise;
  };

  const cancelJob = (id) => {
    const job = jobs.get(id);
    if (!job) return false;
    if (job.status !== 'running') return false;
    void beginTermination(job, job.spec);
    return true;
  };

  /**
   * 杀掉所有还在跑的任务.detached: true 让子进程 setsid() 脱离了终端进程组,
   * 用户按 Ctrl+C 时 SIGINT 只发给前台进程组,子进程收不到 —— 不显式收尾,
   * 关掉 tsuzuri web 之后 remotion/chromium 会变成孤儿继续吃满 CPU 直到渲染完.
   */
  const killAll = async ({deadlineMs = forceKillAfterMs + 2000} = {}) => {
    const active = [...jobs.values()].filter((job) => job.status === 'running' || job.status === 'stopping');
    const terminations = active.map((job) => beginTermination(job, job.spec));
    if (terminations.length === 0) return {clean: true};
    let timer;
    const deadline = new Promise((resolve) => {
      timer = setTimeout(() => resolve('deadline'), deadlineMs);
      timer.unref?.();
    });
    const outcome = await Promise.race([Promise.all(terminations).then(() => 'done'), deadline]);
    clearTimeout(timer);
    if (outcome === 'deadline') {
      for (const job of active) {
        if (job.terminationSettled) continue;
        if (platform === 'win32') void terminateWindowsTree(job, true);
        else freezeThenSignal(job, 'SIGKILL');
        settleTerminationFailure(job, '关闭期限内无法确认进程树退出');
      }
      return {clean: false};
    }
    return {clean: active.every((job) => job.status === 'cancelled')};
  };

  /** 仅供测试观测 SSE 监听者是否被正确清理,生产代码不要用. */
  const _debugListenerCount = (id) => jobs.get(id)?.listeners.size ?? 0;

  // 写文件操作必须以服务端的真实任务状态为准,不能信任浏览器传来的 busy.
  const hasRunningJob = () => runningJobId !== null;

  // 页面刷新/关标签页会丢掉前端内存里的 jobId,但服务端任务还在跑——前端需要
  // 一个"当前有没有任务、是谁的"的探测入口,才能重新 attach 上 SSE.
  const getRunningJob = () => {
    if (runningJobId === null) return null;
    const job = jobs.get(runningJobId);
    return {id: job.id, kind: job.kind, folder: job.folder};
  };

  return {createJob, getJob, subscribeEvents, cancelJob, killAll, hasRunningJob, getRunningJob, _debugListenerCount};
};
