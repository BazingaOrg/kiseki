import {useEffect, useRef, useState} from 'react';
import type {CSSProperties, ReactNode} from 'react';
import {CircleAlert, CircleCheck, Info, Loader2, Play, TriangleAlert, X} from 'lucide-react';

import {collapseJobEvents, formatElapsedClock, formatJobDuration} from './job-events';
import type {CollapsedJobRow} from './job-events';
import type {JobEvent, JobStatus} from './useJob';

/**
 * 渲染阶段的标签由 remotion 的回调名决定,是英文,直接拼进中文界面很突兀。
 * 在这里翻译而不是改 `cli/render.mjs`:那些标签同时印在终端进度条上,
 * 而 `progress.mjs` 用 `padEnd(18)` 对齐,换成全角中文会把终端对齐搞乱。
 * 认不出的标签原样显示,好过显示一个空白。
 */
const STAGE_LABELS: Record<string, string> = {
  'Bundling code': '打包渲染器',
  'Rendering frames': '渲染画面',
  'Encoding video': '编码视频',
  'Rendering still': '导出静态图',
};

/**
 * still 的阶段名带动态计数（`Rendering still 1/3`），静态映射接不住，
 * 所以先整串匹配、再退回前缀匹配并把计数原样留在后面。
 */
const translateStage = (label: string): string => {
  const exact = STAGE_LABELS[label];
  if (exact) return exact;
  for (const [en, zh] of Object.entries(STAGE_LABELS)) {
    if (label.startsWith(`${en} `)) return `${zh} ${label.slice(en.length + 1)}`;
  }
  return label;
};

const EVENT_PRESENTATION = {
  start: {label: '开始', Icon: Play},
  info: {label: '信息', Icon: Info},
  detail: {label: '详情', Icon: Info},
  success: {label: '完成', Icon: CircleCheck},
  warn: {label: '注意', Icon: TriangleAlert},
  error: {label: '错误', Icon: CircleAlert},
  running: {label: '进行中', Icon: Loader2},
} as const;

const JobPathText = ({text, path}: {text: string; path?: string}) => {
  if (path) {
    const at = text.indexOf(path);
    if (at >= 0) {
      return (
        <>
          {text.slice(0, at)}
          <span className="job-path">{path}</span>
          {text.slice(at + path.length)}
        </>
      );
    }
    return (
      <>
        {text} <span className="job-path">{path}</span>
      </>
    );
  }
  const arrow = text.indexOf('→');
  if (arrow < 0) return text;
  return (
    <>
      {text.slice(0, arrow + 1)}
      <span className="job-path">{text.slice(arrow + 1)}</span>
    </>
  );
};

const rowClass = (state: CollapsedJobRow['state']): string => {
  if (state === 'running') return 'job-log-line job-log-start';
  return `job-log-line job-log-${state}`;
};

interface JobPanelProps {
  /** 拼进"正在○○…",如"渲染"/"下载" */
  verb: string;
  status: JobStatus;
  events: JobEvent[];
  error: string | null;
  /** 跑起来之前用户该知道的事,如"第一次要先下模型" */
  note?: ReactNode;
  onCancel: () => void;
  onReset: () => void;
  resetLabel: string;
}

export const JobPanel = ({
  verb,
  status,
  events,
  error,
  note,
  onCancel,
  onReset,
  resetLabel,
}: JobPanelProps) => {
  const logRef = useRef<HTMLDivElement>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const lastProgress = [...events]
    .reverse()
    .find((event): event is Extract<JobEvent, {kind: 'progress'}> => event.kind === 'progress');
  const collapsed = collapseJobEvents(events);
  let lastSuccessDuration: number | undefined;
  for (let i = collapsed.length - 1; i >= 0; i -= 1) {
    const row = collapsed[i];
    if (row.state === 'success' && 'durationMs' in row && row.durationMs != null) {
      lastSuccessDuration = row.durationMs;
      break;
    }
  }

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [events]);

  useEffect(() => {
    if (status !== 'running') {
      setElapsedMs(0);
      return;
    }
    const startedAt = Date.now();
    setElapsedMs(0);
    const id = window.setInterval(() => {
      setElapsedMs(Date.now() - startedAt);
    }, 1000);
    return () => window.clearInterval(id);
  }, [status]);

  const statusLabel =
    status === 'running'
      ? `正在${verb}…`
      : status === 'done'
        ? '完成了。'
        : status === 'cancelled'
          ? '已取消。'
          : '失败了。';

  return (
    <div className="job-panel">
      <div className="job-status" role="status" aria-live="polite">
        {status === 'running' && <Loader2 size={15} className="job-spinner" aria-hidden="true" />}
        <span>{statusLabel}</span>
        {status === 'running' && <span className="job-elapsed">{formatElapsedClock(elapsedMs)}</span>}
        {status !== 'running' && lastSuccessDuration != null && (
          <span className="job-elapsed">{formatJobDuration(lastSuccessDuration)}</span>
        )}
      </div>

      {status === 'running' &&
        (lastProgress ? (
          <>
            <div className="job-progress-summary">
              <span>{translateStage(lastProgress.label)}</span>
              <span>{lastProgress.percent}%</span>
            </div>
            <div className="job-progress" role="progressbar" aria-label={`${verb}进度`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={lastProgress.percent} aria-valuetext={`${translateStage(lastProgress.label)} ${lastProgress.percent}%`}>
              <span className="job-progress-fill" style={{transform: `scaleX(${lastProgress.percent / 100})`} as CSSProperties} />
            </div>
          </>
        ) : (
          <div className="job-progress job-progress-indeterminate" role="progressbar" aria-label={`${verb}进度`} aria-valuetext="正在处理，暂时无法估计进度" />
        ))}

      {status === 'running' && note && <p className="hint job-note">{note}</p>}

      {error && <p className="hint hint-error" role="alert">{error}</p>}

      {collapsed.length > 0 && (
        <div className="job-log" ref={logRef}>
          {collapsed.map((row) => {
            const presentation = EVENT_PRESENTATION[row.state];
            const Icon = presentation.Icon;
            const text = 'text' in row ? row.text : row.label;
            const durationMs = 'durationMs' in row ? row.durationMs : undefined;
            return (
              <p className={rowClass(row.state)} key={row.key}>
                <Icon
                  size={13}
                  strokeWidth={1.8}
                  aria-hidden="true"
                  className={row.state === 'running' ? 'job-spinner' : undefined}
                />
                <span className="job-log-kind">{presentation.label}</span>
                <span>
                  <JobPathText text={text} path={'path' in row ? row.path : undefined} />
                  {durationMs != null && (
                    <span className="job-elapsed"> {formatJobDuration(durationMs)}</span>
                  )}
                </span>
              </p>
            );
          })}
        </div>
      )}

      <div className="job-actions">
        {status === 'running' ? (
          <button className="job-cancel" onClick={onCancel}>
            <X size={14} /> 取消
          </button>
        ) : (
          <button className="link-button" onClick={onReset}>
            {resetLabel}
          </button>
        )}
      </div>
    </div>
  );
};
