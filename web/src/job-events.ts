import type {JobEvent, JobStatus} from './useJob';

export type CollapsedJobRow =
  | {key: string; label: string; state: 'running'}
  | {key: string; label: string; state: 'success' | 'error'; durationMs?: number; path?: string}
  | {key: string; label: string; state: 'start' | 'info' | 'success' | 'warn' | 'error' | 'detail'; text: string; path?: string};

const KIND_LABELS = {
  start: '开始',
  info: '信息',
  detail: '详情',
  success: '完成',
  warn: '注意',
  error: '错误',
} as const;

const foldKeyOf = (event: Extract<JobEvent, {text: string}>): string => event.stage ?? event.text;

export const formatJobDuration = (ms: number): string => {
  const elapsed = Number(ms);
  const safe = Number.isFinite(elapsed) && elapsed > 0 ? elapsed : 0;
  if (safe < 60_000) return `${(safe / 1000).toFixed(1)}s`;
  const totalSeconds = Math.round(safe / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
};

export const formatElapsedClock = (ms: number): string => {
  const elapsed = Number(ms);
  const safe = Number.isFinite(elapsed) && elapsed > 0 ? elapsed : 0;
  const totalSeconds = Math.floor(safe / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
};

export const collapseJobEvents = (events: JobEvent[]): CollapsedJobRow[] => {
  const semantic = events.filter(
    (event): event is Exclude<JobEvent, {kind: 'progress'}> => event.kind !== 'progress',
  );

  const started = new Set<string>();
  const finished = new Set<string>();
  for (const event of semantic) {
    const key = foldKeyOf(event);
    if (event.kind === 'start') started.add(key);
    if (event.kind === 'success' || event.kind === 'error') finished.add(key);
  }

  const rows: CollapsedJobRow[] = [];
  const indexByKey = new Map<string, number>();

  semantic.forEach((event, index) => {
    const foldable =
      event.kind === 'start' || event.kind === 'success' || event.kind === 'error';
    const foldKey = foldKeyOf(event);
    const shouldFold =
      foldable && (Boolean(event.stage) || (started.has(foldKey) && finished.has(foldKey)));

    if (!shouldFold) {
      rows.push({
        key: `event:${index}`,
        label: KIND_LABELS[event.kind],
        state: event.kind,
        text: event.text,
        path: event.path,
      });
      return;
    }

    const rowKey = `stage:${foldKey}`;
    const next: CollapsedJobRow = event.kind === 'start'
      ? {key: rowKey, label: event.text, state: 'running'}
      : event.kind === 'error'
        ? {key: rowKey, label: event.text, state: 'error', durationMs: event.durationMs, path: event.path}
        : {key: rowKey, label: event.text, state: 'success', durationMs: event.durationMs, path: event.path};

    const existing = indexByKey.get(foldKey);
    if (existing !== undefined) {
      rows[existing] = next;
      return;
    }
    indexByKey.set(foldKey, rows.length);
    rows.push(next);
  });

  return rows;
};

const TEXT_EVENT_KINDS = new Set(['start', 'info', 'success', 'warn', 'error', 'detail']);

export const parseJobEvent = (raw: unknown): JobEvent | null => {
  if (!raw || typeof raw !== 'object') return null;
  const data = raw as Record<string, unknown>;
  if (data.kind === 'progress') {
    if (typeof data.label !== 'string' || typeof data.percent !== 'number') return null;
    const event: Extract<JobEvent, {kind: 'progress'}> = {kind: 'progress', label: data.label, percent: data.percent};
    if (data.counts && typeof data.counts === 'object') {
      const counts = data.counts as Record<string, unknown>;
      if (typeof counts.completed === 'number' && typeof counts.total === 'number') {
        event.counts = {
          completed: counts.completed,
          total: counts.total,
          ...(typeof counts.reused === 'number' ? {reused: counts.reused} : {}),
          ...(typeof counts.generated === 'number' ? {generated: counts.generated} : {}),
        };
      }
    }
    return event;
  }
  if (typeof data.kind !== 'string' || !TEXT_EVENT_KINDS.has(data.kind) || typeof data.text !== 'string') {
    return null;
  }
  const event: Extract<JobEvent, {text: string}> = {
    kind: data.kind as Extract<JobEvent, {text: string}>['kind'],
    text: data.text,
  };
  if (typeof data.stage === 'string') event.stage = data.stage;
  if (typeof data.durationMs === 'number' && Number.isFinite(data.durationMs)) event.durationMs = data.durationMs;
  if (typeof data.path === 'string') event.path = data.path;
  if (typeof data.failureStage === 'string') event.failureStage = data.failureStage;
  if (typeof data.code === 'string') event.code = data.code;
  return event;
};

export const hasPhotoCaptionFailure = (
  status: JobStatus,
  failureStage: string | null | undefined,
  events: JobEvent[],
): boolean =>
  status === 'failed' && (
    failureStage === 'photo-caption'
    || events.some((event) => event.kind !== 'progress' && event.failureStage === 'photo-caption')
  );
