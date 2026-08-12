import {useEffect, useRef, useState} from 'react';

import type {LyricLine} from './types';
import {RENDER_CONFIDENCE_THRESHOLD} from './types';

/**
 * 已按时间升序,找最后一条 time <= currentTime 的行。
 * 带 `until` 的行到点就不再算当前行 —— 那是 .lrc 里"这一句到此为止"的标记,
 * 没有它,间奏那十几秒里上一句会一直挂着高亮不消失。
 */
export const findActiveLine = (lyrics: LyricLine[], currentTime: number): number => {
  let index = -1;
  for (let i = 0; i < lyrics.length; i += 1) {
    if (lyrics[i].time <= currentTime) index = i;
    else break;
  }
  if (index < 0) return -1;
  const until = lyrics[index].until;
  return typeof until === 'number' && currentTime >= until ? -1 : index;
};

const RESUME_FOLLOW_AFTER_MS = 3000;
const SCROLL_DURATION_MS = 420;

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

interface LyricsProps {
  lyrics: LyricLine[];
  currentTime: number;
  onSeek: (seconds: number) => void;
}

export const Lyrics = ({lyrics, currentTime, onSeek}: LyricsProps) => {
  const listRef = useRef<HTMLOListElement | null>(null);
  const lineRefs = useRef<Array<HTMLLIElement | null>>([]);
  const [following, setFollowing] = useState(true);
  const activeIndex = findActiveLine(lyrics, currentTime);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return undefined;
    let resumeTimer: number | undefined;
    const onUserScroll = () => {
      setFollowing(false);
      window.clearTimeout(resumeTimer);
      resumeTimer = window.setTimeout(() => setFollowing(true), RESUME_FOLLOW_AFTER_MS);
    };
    const events: (keyof HTMLElementEventMap)[] = ['wheel', 'touchmove', 'pointerdown', 'keydown'];
    for (const name of events) list.addEventListener(name, onUserScroll, {passive: true});
    return () => {
      window.clearTimeout(resumeTimer);
      for (const name of events) list.removeEventListener(name, onUserScroll);
    };
  }, []);

  useEffect(() => {
    const list = listRef.current;
    const line = lineRefs.current[activeIndex];
    if (!list || !line || !following || activeIndex < 0) return undefined;

    // offsetTop 会受 offsetParent、margin 与滚动容器嵌套影响。以同一坐标系的视口
    // 矩形求两者中心差，再叠加现有 scrollTop，当前行才会真正落在歌词视窗正中。
    const listRect = list.getBoundingClientRect();
    const lineRect = line.getBoundingClientRect();
    const centeredTarget = list.scrollTop
      + (lineRect.top + lineRect.height / 2)
      - (listRect.top + listRect.height / 2);
    const target = Math.max(0, Math.min(centeredTarget, list.scrollHeight - list.clientHeight));
    const from = list.scrollTop;
    const distance = target - from;
    if (Math.abs(distance) < 1) return undefined;
    if (prefersReducedMotion()) {
      list.scrollTop = target;
      return undefined;
    }

    let frame = 0;
    let start: number | null = null;
    const step = (now: number) => {
      if (start === null) start = now;
      const progress = Math.min(1, (now - start) / SCROLL_DURATION_MS);
      list.scrollTop = from + distance * (1 - (1 - progress) ** 3);
      if (progress < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [activeIndex, following]);

  return (
    <ol className="lyrics-list" ref={listRef}>
      {lyrics.map((line, index) => {
        const distance =
          activeIndex < 0 ? 'idle' : String(Math.min(Math.abs(index - activeIndex), 3));
        return (
          <li
            key={`${line.time}-${index}`}
            ref={(element) => {
              lineRefs.current[index] = element;
            }}
            className={index === activeIndex ? 'lyric-line lyric-line-active' : 'lyric-line'}
            data-distance={distance}
          >
            <button className="lyric-seek" onClick={() => onSeek(line.time)}>
              {line.text || '⋯'}
              {typeof line.confidence === 'number' && line.confidence < RENDER_CONFIDENCE_THRESHOLD && (
                <span className="lyric-uncertain" title="识别把握不大，渲染时这一行不会出现在成片里">
                  不确定
                </span>
              )}
            </button>
          </li>
        );
      })}
    </ol>
  );
};
