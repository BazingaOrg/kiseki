import {formatTime} from './useMediaPlayer';
import type {CSSProperties} from 'react';

interface MediaTimelineProps {
  currentTime: number;
  duration: number;
  buffered?: number;
  onSeek: (seconds: number) => void;
  label?: string;
}

export const MediaTimeline = ({currentTime, duration, buffered = 0, onSeek, label = '播放进度'}: MediaTimelineProps) => {
  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const value = Math.min(Math.max(currentTime, 0), safeDuration);
  const bufferedPercent = safeDuration ? Math.min(buffered / safeDuration, 1) * 100 : 0;

  return (
    <div className="media-timeline">
      <input
        className="media-timeline-range"
        type="range"
        min={0}
        max={safeDuration}
        step={0.1}
        value={value}
        onChange={(event) => onSeek(Number(event.target.value))}
        aria-label={label}
        aria-valuetext={`${formatTime(value)} / ${formatTime(safeDuration)}`}
        style={{'--buffered-progress': `${bufferedPercent}%`} as CSSProperties}
      />
      <span className="media-timeline-time" aria-live="off">{formatTime(value)} / {formatTime(safeDuration)}</span>
    </div>
  );
};
