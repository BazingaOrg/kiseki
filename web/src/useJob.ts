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

  const start = useCallback(
    (args: StartJobArgs) => {
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
          if (!mountedRef.current) return;
          jobIdRef.current = id;
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
        })
        .catch((err: Error) => {
          if (!mountedRef.current) return;
          setStatus('failed');
          setError(err.message === 'busy' ? '已经有一个任务在跑，等它结束再试。' : '任务没能起来。');
        });
    },
    [closeSource, onEnd],
  );

  const cancel = useCallback(() => {
    if (!jobIdRef.current) return;
    fetch(`/api/jobs/${jobIdRef.current}/cancel`, {
      method: 'POST',
      headers: {'X-Tsuzuri-Token': getToken()},
    }).catch(() => {});
  }, []);

  return {status, events, error, start, cancel};
};
