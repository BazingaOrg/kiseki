/**
 * 歌词跟播。两处相对旧版的实质改动:
 *
 * 1. 视觉不再靠 font-weight/font-size 跳变。当前行满不透明并轻微放大,其余按距离
 *    衰减透明度 —— 改 font-size 会逐帧触发重排,transform/opacity 不会。
 * 2. 自动滚动改成自己补间的 rAF,可以被用户滚动打断。旧版 scrollIntoView({smooth})
 *    一旦发起就抢走滚动条,用户想往回翻几句都做不到。打断后 3 秒无操作再恢复跟随。
 */
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

  // 用户一滚动就交出控制权,静置一段时间再收回
  useEffect(() => {
    const list = listRef.current;
    if (!list) return undefined;
    let resumeTimer: number | undefined;
    const onUserScroll = () => {
      setFollowing(false);
      window.clearTimeout(resumeTimer);
      resumeTimer = window.setTimeout(() => setFollowing(true), RESUME_FOLLOW_AFTER_MS);
    };
    // 滚轮、触摸、拖滚动条、键盘翻页 —— 任何一种都算"用户接管了"
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

    const target = line.offsetTop - list.clientHeight / 2 + line.clientHeight / 2;
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
      // easeOutCubic:起步快、收尾稳,和 CSS 的 ease-out 观感一致
      list.scrollTop = from + distance * (1 - (1 - progress) ** 3);
      if (progress < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [activeIndex, following]);

  return (
    <ol className="lyrics-list" ref={listRef}>
      {lyrics.map((line, index) => {
        // 还没开始播(或停在前奏)时不该把每一行都淡到最远那一档 —— 那看着像页面坏了。
        // 单独给一个 idle 档,整段以可读的浓度静静待着。
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
              {/* 识别置信度低于渲染阈值的行,成片里不会显示字幕 —— 提前说清楚 */}
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
