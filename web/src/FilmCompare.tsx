import {useEffect, useLayoutEffect, useRef, useState, type CSSProperties} from 'react';

import {ArrowLeftRight} from 'lucide-react';

import type {FilmViewMode} from './film-state';

import './FilmCompare.css';

export interface FilmCompareProps {
  originalSrc: string;
  effectSrc: string | null;
  alt: string;
  effectLabel: string;
  mode: FilmViewMode;
  animateView: boolean;
  imageSize?: {width: number; height: number};
  holding: boolean;
  busy: boolean;
  error: string | null;
  onSwap: () => void;
}

type ImageBounds = {width: number; height: number; left: number; top: number};

export const FilmCompare = ({
  originalSrc,
  effectSrc,
  alt,
  effectLabel,
  mode,
  animateView,
  imageSize,
  holding,
  busy,
  error,
  onSwap,
}: FilmCompareProps) => {
  const stageRef = useRef<HTMLDivElement>(null);
  const [naturalSize, setNaturalSize] = useState<{src: string; width: number; height: number} | null>(null);
  const [stageSize, setStageSize] = useState<{width: number; height: number}>({width: 0, height: 0});

  const [failedSource, setFailedSource] = useState<string | null>(null);

  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return undefined;
    const measure = () => setStageSize({width: stage.clientWidth, height: stage.clientHeight});
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  const size = imageSize ?? (naturalSize?.src === originalSrc ? naturalSize : null);
  const bounds: ImageBounds | null = size && size.width > 0 && stageSize.width > 0 && stageSize.height > 0
    ? (() => {
      const scale = Math.min(stageSize.width / size.width, stageSize.height / size.height);
      const width = size.width * scale;
      const height = size.height * scale;
      return {width, height, left: (stageSize.width - width) / 2, top: (stageSize.height - height) / 2};
    })()
    : null;

  const originalFailed = failedSource === originalSrc;
  const effectReady = Boolean(effectSrc) && !originalFailed && Boolean(bounds);
  const showEffect = effectReady && !holding && mode === 'effect';
  const showCompare = effectReady && !holding && mode !== 'effect';
  const swapped = mode === 'effect-left';

  const imageStyle = bounds ? {
    '--film-compare-width': `${bounds.width}px`,
    '--film-compare-height': `${bounds.height}px`,
    '--film-compare-left': `${bounds.left}px`,
    '--film-compare-top': `${bounds.top}px`,
  } as CSSProperties : undefined;

  const recordOriginalSize = (event: {currentTarget: HTMLImageElement}) => {
    setFailedSource(null);
    setNaturalSize({src: originalSrc, width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight});
  };

  const waiting = !originalFailed && !error && (busy || !bounds || !effectSrc);
  const [showLoading, setShowLoading] = useState(false);
  useEffect(() => {
    if (!waiting) { setShowLoading(false); return; }
    const timer = window.setTimeout(() => setShowLoading(true), 250);
    return () => window.clearTimeout(timer);
  }, [waiting, originalSrc]);
  const status = originalFailed ? '原图没能读取，请重新打开预览。' : error ?? (waiting && showLoading
    ? busy ? '正在更新预览…' : !bounds ? '正在读取照片…' : '等待效果预览'
    : null);
  const leftLabel = swapped ? effectLabel : '原图';
  const rightLabel = swapped ? '原图' : effectLabel;

  return (
    <section className="film-compare" aria-label="照片效果预览" aria-busy={waiting}>
      <div ref={stageRef} className="film-compare-stage">
        <div className={bounds ? 'film-compare-image-area' : 'film-compare-image-area film-compare-image-area-loading'} style={imageStyle}>
          <img className="film-compare-image" src={originalSrc} alt={`${alt}，原图`} onLoad={recordOriginalSize} />
          {effectReady && effectSrc ? (
            <img
              className={`film-compare-image film-compare-effect${animateView ? ' film-compare-effect-animated' : ''}`}
              src={effectSrc}
              alt={`${alt}，${effectLabel}`}
              style={{clipPath: mode === 'effect' ? 'inset(0 0 0 0)' : swapped ? 'inset(0 50% 0 0)' : 'inset(0 0 0 50%)', opacity: holding ? 0 : 1}}
              aria-hidden={holding}
            />
          ) : null}
          <div className="film-compare-label film-compare-label-left">{showCompare ? leftLabel : showEffect ? effectLabel : '原图'}</div>
          <div className="film-compare-label film-compare-label-right" hidden={!showCompare}>{rightLabel}</div>
          <div className={`film-compare-divider${showCompare ? ' film-compare-divider-visible' : ''}${animateView && !holding ? ' film-compare-divider-animated' : ''}`} aria-hidden={!showCompare}>
            <span className="film-compare-divider-line" aria-hidden="true" />
            <button
              type="button"
              className="film-compare-swap"
              aria-label="交换左右对比"
              aria-pressed={swapped}
              title="交换原图和效果的位置"
              disabled={!showCompare}
              onClick={onSwap}
            >
              <span className="film-compare-divider-grip"><ArrowLeftRight size={14} aria-hidden="true" /></span>
            </button>
          </div>
        </div>
        <img key={originalSrc} className="film-compare-natural-probe" src={originalSrc} alt="" aria-hidden="true" onLoad={recordOriginalSize} onError={() => setFailedSource(originalSrc)} />
      </div>
      <p className="film-compare-status" role="status">{status}</p>
    </section>
  );
};

export default FilmCompare;
