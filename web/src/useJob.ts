import {useCallback, useEffect, useRef, useState} from 'react';

import {getToken} from './api';
import {clearLastJobRecord, writeLastJobRecord} from './lastJob';

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
  /** 仅 render:呈现层模板 id,见 renderer/src/templates.ts;null = 不应用模板 */
  template?: string | null;
  /** 仅 still */
  scale?: number;
}

/** 起 fetch-audio 用的选项:后端拿 title/artist 拼落地文件名(buildAudioFilename)。 */
export interface FetchAudioOptions {
  id: string;
  title: string;
  artist: string;
}

export interface LyricsJobOptions {
  replace?: boolean;
}

/**
 * 一次任务请求里除 folder 之外的部分。folder 由持有任务状态的那一层补上,
 * 起任务的组件不必自己传素材夹路径。
 */
export type JobRequest =
  | {kind: 'render' | 'still'; options: JobOptions}
  | {kind: 'fetch-audio'; options: FetchAudioOptions}
  | {kind: 'lyrics'; options?: LyricsJobOptions};

export type JobKind = JobRequest['kind'];

export type StartJobArgs = JobRequest & {folder: string};

export const useJob = (onEnd?: () => void, onDisconnect?: () => void) => {
  const [status, setStatus] = useState<JobStatus>('idle');
  const [events, setEvents] = useState<JobEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const sourceRef = useRef<EventSource | null>(null);
  const jobIdRef = useRef<string | null>(null);
  const mountedRef = useRef(true);
  // 阻止旧请求与旧 SSE 回调覆盖后发任务。
  const runRef = useRef(0);
  const startingRef = useRef(false);
  const cancelPendingRef = useRef(false);

  const closeSource = useCallback((source?: EventSource) => {
    // 旧连接的延迟回调只能关它自己，不能把后来接管的 SSE 一并关掉。
    if (source && sourceRef.current !== source) {
      source.close();
      return;
    }
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

  /** 订阅任务事件；run 用于拒绝已过期任务的回调。 */
  const attach = useCallback(
    (id: string, run: number) => {
      if (!mountedRef.current || run !== runRef.current) return;

      closeSource();

      const source = new EventSource(`/api/jobs/${id}/events`);
      sourceRef.current = source;

      source.onmessage = (event) => {
        if (!mountedRef.current || run !== runRef.current || sourceRef.current !== source) return;
        const parsed = JSON.parse(event.data) as JobEvent;
        // progress 是高频、可替代的当前快照；保留它只会让长任务的 React 队列和
        // 日志不断膨胀。开始、详情、完成、警告与错误则是不可替代的任务语义，按
        // 到达顺序完整留下。服务端重放同样遵循这份契约，双层收口防止旧服务积压。
        setEvents((prev) =>
          parsed.kind === 'progress'
            ? [...prev.filter((item) => item.kind !== 'progress'), parsed]
            : [...prev, parsed],
        );
      };

      source.addEventListener('end', (event) => {
        if (!mountedRef.current || run !== runRef.current || sourceRef.current !== source) return;
        const payload = JSON.parse((event as MessageEvent).data) as {status: JobStatus};
        setStatus(payload.status);
        clearLastJobRecord();
        closeSource(source);
        onEnd?.();
      });

      source.onerror = () => {
        if (mountedRef.current && sourceRef.current === source) {
          setError('进度连接断开了，正在确认后台任务。');
          // 先以失败态保留可见错误；若 probe 发现任务仍在，reconnect 会把它恢复成
          // running。若服务端已无任务，则 current: null 只释放锁，保留这个终态。
          setStatus('failed');
          onDisconnect?.();
        }
        closeSource(source);
      };
    },
    [closeSource, onDisconnect, onEnd],
  );

  const start = useCallback(
    async (args: StartJobArgs): Promise<boolean> => {
      if (startingRef.current) return false;
      const run = ++runRef.current;
      startingRef.current = true;
      cancelPendingRef.current = false;
      jobIdRef.current = null;

      closeSource();
      setEvents([]);
      setError(null);
      setStatus('running');

      try {
        const res = await fetch('/api/jobs', {
          method: 'POST',
          headers: {'Content-Type': 'application/json', 'X-Kiseki-Token': getToken()},
          body: JSON.stringify(args),
        });
        if (res.status === 409) throw new Error('busy');
        if (!res.ok) throw new Error('failed');
        const {id} = await res.json() as {id: string};

        // 即使调用方已过期，也要先保留服务端已创建的任务 id，供取消路径使用。
        startingRef.current = false;
        jobIdRef.current = id;
        writeLastJobRecord({id, kind: args.kind, folder: args.folder, at: Date.now()});
        if (!mountedRef.current || run !== runRef.current) return false;

        if (cancelPendingRef.current) {
          cancelPendingRef.current = false;
          fetch(`/api/jobs/${id}/cancel`, {
            method: 'POST',
            headers: {'X-Kiseki-Token': getToken()},
          }).catch(() => setError('取消请求没发出去，任务可能还在后台跑。'));
        }

        attach(id, run);
        return true;
      } catch (err) {
        startingRef.current = false;
        if (!mountedRef.current || run !== runRef.current) return false;
        setStatus('failed');
        setError(err instanceof Error && err.message === 'busy' ? '已经有一个任务在跑（可能是另一个标签页开着）。等它结束再试。' : '任务没能起来。');
        return false;
      }
    },
    [closeSource, attach],
  );

  /** 重新接管服务端任务；保留事件，避免与 SSE 重放互相覆盖。 */
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
      headers: {'X-Kiseki-Token': getToken()},
    }).catch(() => setError('取消请求没发出去，任务可能还在后台跑。'));
  }, []);

  /**
   * 仅在 `/api/jobs/current` 明确返回 `job: null` 后由上层调用。
   *
   * 这里只释放本地对服务端任务的持有与 SSE；终态（done/failed/cancelled）的
   * 日志和错误仍应留在面板中，直到用户主动调整参数或重新开始。
   */
  const release = useCallback(() => {
    ++runRef.current;
    jobIdRef.current = null;
    cancelPendingRef.current = false;
    closeSource();
  }, [closeSource]);

  /** 用户主动离开终态面板时，才清除那次任务的展示状态。 */
  const resetDisplay = useCallback(() => {
    setEvents([]);
    setError(null);
    setStatus('idle');
  }, []);

  return {status, events, error, busy: status === 'running', start, cancel, reconnect, release, resetDisplay};
};
