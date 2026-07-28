/**
 * 任务进度面板:状态 + 进度条 + 日志 + 取消。
 *
 * 从 Make.tsx 提出来是因为素材段的「在线取音频」「本地识别歌词」也走同一套任务系统,
 * 事件形状完全一致(批 B 契约一),没有理由维护两份面板。差异只有动词和收起时的按钮
 * 文案,所以参数化的只有这两项。
 */
import {useEffect, useRef} from 'react';
import type {ReactNode} from 'react';
import {Loader2, X} from 'lucide-react';

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
  'Rendering still': '导出照片',
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

const eventText = (event: JobEvent): string =>
  event.kind === 'progress'
    ? `${translateStage(event.label)} ${event.percent}%`
    : event.text;

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
  // 只有收到过带 percent 的 progress 事件才画确定进度条,纯日志(start/info…)期间用不确定态
  const lastProgress = [...events]
    .reverse()
    .find((event): event is Extract<JobEvent, {kind: 'progress'}> => event.kind === 'progress');

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [events]);

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
      </div>

      {status === 'running' &&
        (lastProgress ? (
          <progress className="job-progress" value={lastProgress.percent} max={100} aria-label={`${verb}进度`} aria-valuetext={`${lastProgress.percent}%`} />
        ) : (
          <div className="job-progress job-progress-indeterminate" role="progressbar" aria-label={`${verb}进度`} aria-valuetext="正在处理，暂时无法估计进度" />
        ))}

      {status === 'running' && note && <p className="hint job-note">{note}</p>}

      {error && <p className="hint hint-error" role="alert">{error}</p>}

      {events.length > 0 && (
        <div className="job-log" ref={logRef}>
          {events.map((event, index) => (
            <p className="job-log-line" key={index}>
              {eventText(event)}
            </p>
          ))}
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
