/**
 * 任务生命周期:起任务 → 订阅 SSE 进度 → （可选）取消。
 *
 * token 只在非 GET 请求上带 —— 这是契约二定的规矩，EventSource 本身发不出自定义头，
 * 好在 GET 的 events 端点契约里也不要求 token，两边对得上。
 */
import {useCallback, useEffect, useRef, useState} from 'react';

import {getToken} from './api';

/** 契约一的两种事件形状 */
export type JobEvent =
  | {kind: 'start' | 'info' | 'success' | 'warn' | 'error' | 'detail'; text: string}
  | {kind: 'progress'; label: string; percent: number};

export type JobStatus = 'idle' | 'running' | 'done' | 'failed' | 'cancelled';

export interface JobOptions {
  exif: boolean;
  sign: boolean;
  dark: boolean;
  format: 'landscape' | 'portrait' | 'square';
  filter: string | null;
  filterIntensity: number | null;
  /** 仅 render */
  draft?: boolean;
  /** 仅 render */
  trim?: 'auto' | 'full' | null;
  /** 仅 render:并发档位。still 不走 resolveRenderSettings,设了也没用 */
  speed?: 'saver' | 'balanced' | 'full';
  /** 仅 still */
  scale?: number;
}

/** 起 fetch-audio 用的选项:后端拿 title/artist 拼落地文件名(buildAudioFilename)。 */
export interface FetchAudioOptions {
  id: string;
  title: string;
  artist: string;
}

/**
 * 一次任务请求里除 folder 之外的部分。folder 由持有任务状态的那一层补上,
 * 起任务的组件不必自己传素材夹路径。
 */
export type JobRequest =
  | {kind: 'render' | 'still'; options: JobOptions}
  | {kind: 'fetch-audio'; options: FetchAudioOptions}
  // 本地识别只要素材夹,没有可调的参数
  | {kind: 'lyrics'};

export type JobKind = JobRequest['kind'];

export type StartJobArgs = JobRequest & {folder: string};

export const useJob = (onEnd?: () => void) => {
  const [status, setStatus] = useState<JobStatus>('idle');
  const [events, setEvents] = useState<JobEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const sourceRef = useRef<EventSource | null>(null);
  const jobIdRef = useRef<string | null>(null);
  // start() 之后组件可能已经卸载,onEnd 回调不该再触发外部状态更新
  const mountedRef = useRef(true);
  // 代次:晚到的 POST 响应用它判断自己是否已经被更晚的一次 start() 取代
  const runRef = useRef(0);
  // POST 在途时重复提交直接丢弃,不然并发 start 会互相踩状态
  const startingRef = useRef(false);
  // 点了取消但 job id 还没回来:等 id 到手后补发一次
  const cancelPendingRef = useRef(false);

  const closeSource = useCallback(() => {
    sourceRef.current?.close();
    sourceRef.current = null;
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      closeSource();
    };
  }, [closeSource]);

  /**
   * 给定一个已经在服务端跑着的 job id,挂上 EventSource 接管它的事件。
   * start() 拿到刚创建的 id 后用它;重连场景(刷新页面后发现服务端还有
   * 任务在跑)也用同一份逻辑——subscribeEvents 本来就会把历史事件重放一遍,
   * 两种场景不需要区分对待。
   *
   * run 是调用方此刻的代次号(不是在这里重新读 runRef.current),语义与
   * start() 里 `run !== runRef.current` 的判断一致:谁的 run 先过期,
   * 谁的回调就不生效。
   */
  const attach = useCallback(
    (id: string, run: number) => {
      if (!mountedRef.current || run !== runRef.current) return;

      // 接管前先关掉可能还开着的上一条:start() 已经关过一次(幂等,无害),
      // 但 reconnect() 没有,漏掉这行就会留下一条没人读、也没人关的连接。
      closeSource();

      // 即使补发了取消,依旧照常挂 EventSource —— 服务端的 end 帧会把状态
      // 定成 cancelled,不必在这里自己猜结果。
      const source = new EventSource(`/api/jobs/${id}/events`);
      sourceRef.current = source;

      source.onmessage = (event) => {
        const parsed = JSON.parse(event.data) as JobEvent;
        setEvents((prev) => [...prev, parsed]);
      };

      source.addEventListener('end', (event) => {
        const payload = JSON.parse((event as MessageEvent).data) as {status: JobStatus};
        if (mountedRef.current) setStatus(payload.status);
        closeSource();
        onEnd?.();
      });

      // 连接本身断了(不是任务失败,是没收到 end 事件就断流),别让用户一直盯着转圈
      source.onerror = () => {
        if (mountedRef.current && sourceRef.current === source) {
          setError('进度连接断开了。任务可能仍在后台运行，稍后刷新成果查看。');
          setStatus('failed');
        }
        closeSource();
      };
    },
    [closeSource, onEnd],
  );

  const start = useCallback(
    (args: StartJobArgs) => {
      // POST 在途时重复提交直接丢弃,不然并发 start 会互相踩状态(见文件头注释里的竞态清单)
      if (startingRef.current) return;
      const run = ++runRef.current;
      startingRef.current = true;
      cancelPendingRef.current = false;
      jobIdRef.current = null;

      closeSource();
      setEvents([]);
      setError(null);
      setStatus('running');

      fetch('/api/jobs', {
        method: 'POST',
        headers: {'Content-Type': 'application/json', 'X-Tsuzuri-Token': getToken()},
        body: JSON.stringify(args),
      })
        .then((res) => {
          if (res.status === 409) throw new Error('busy');
          if (!res.ok) throw new Error('failed');
          return res.json() as Promise<{id: string}>;
        })
        .then(({id}) => {
          // 先落 id、再判断是否被取代 —— 反过来(先判断)会让 jobIdRef 永远赋不上值,
          // EventSource 建不起来,服务端 job 却已经在跑,runningJobId 从此占死。
          startingRef.current = false;
          jobIdRef.current = id;
          if (!mountedRef.current || run !== runRef.current) return;

          if (cancelPendingRef.current) {
            cancelPendingRef.current = false;
            fetch(`/api/jobs/${id}/cancel`, {
              method: 'POST',
              headers: {'X-Tsuzuri-Token': getToken()},
            }).catch(() => setError('取消请求没发出去，任务可能还在后台跑。'));
          }

          attach(id, run);
        })
        .catch((err: Error) => {
          startingRef.current = false;
          if (!mountedRef.current || run !== runRef.current) return;
          setStatus('failed');
          // 守卫落地后,409 只可能来自另一个标签页或另一个服务实例
          setError(err.message === 'busy' ? '已经有一个任务在跑（可能是另一个标签页开着）。等它结束再试。' : '任务没能起来。');
        });
    },
    [closeSource, onEnd, attach],
  );

  /**
   * 页面刷新/重开标签页后,前端内存里的 jobId 和 EventSource 都没了,但服务端
   * 任务(runningJobId)可能还在跑。调用方(Workbench mount 时)探测到这种情况后
   * 用这个方法重新接管:只挂 EventSource,不清 events——这不是新起任务,而是
   * 接回一个已经在跑的任务,subscribeEvents 会把历史事件重放一遍,清空 events
   * 反而会让重放和"清空前的状态"打架。也不调用 closeSource():mount 时不存在
   * 需要关闭的旧连接。
   *
   * 推进 runRef 是为了与后续可能发生的 start() 保持正确的代次互斥语义——
   * 谁的 run 新,谁的回调生效。
   */
  const reconnect = useCallback(
    (id: string) => {
      const run = ++runRef.current;
      jobIdRef.current = id;
      setError(null);
      setStatus('running');
      attach(id, run);
    },
    [attach],
  );

  const cancel = useCallback(() => {
    if (!jobIdRef.current) {
      // id 还没从 POST 响应里回来:记下来,等 start() 拿到 id 后补发
      cancelPendingRef.current = true;
      return;
    }
    fetch(`/api/jobs/${jobIdRef.current}/cancel`, {
      method: 'POST',
      headers: {'X-Tsuzuri-Token': getToken()},
    }).catch(() => setError('取消请求没发出去，任务可能还在后台跑。'));
  }, []);

  return {status, events, error, start, cancel, reconnect};
};
