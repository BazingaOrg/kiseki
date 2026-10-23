import {useCallback, useLayoutEffect, useRef, useState} from 'react';
import {photoStripTarget} from './photo-strip-scroll';

export const usePhotoStrip = (count: number) => {
  const ref = useRef<HTMLOListElement>(null);
  const frame = useRef<number | null>(null);
  const [edges, setEdges] = useState({left: false, right: false});

  const stop = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
  }, []);

  useLayoutEffect(() => {
    const strip = ref.current;
    if (!strip) return;
    const measure = () => {
      const left = strip.scrollLeft > 1;
      const right = strip.scrollLeft + strip.clientWidth < strip.scrollWidth - 1;
      setEdges((previous) => previous.left === left && previous.right === right ? previous : {left, right});
    };
    const resize = () => { stop(); measure(); };
    const observer = new ResizeObserver(resize);
    observer.observe(strip);
    strip.addEventListener('scroll', measure, {passive: true});
    strip.addEventListener('wheel', stop, {passive: true});
    strip.addEventListener('pointerdown', stop, {passive: true});
    strip.addEventListener('touchstart', stop, {passive: true});
    strip.addEventListener('keydown', stop);
    measure();
    return () => {
      stop();
      observer.disconnect();
      strip.removeEventListener('scroll', measure);
      strip.removeEventListener('wheel', stop);
      strip.removeEventListener('pointerdown', stop);
      strip.removeEventListener('touchstart', stop);
      strip.removeEventListener('keydown', stop);
    };
  }, [count, stop]);

  const follow = useCallback((index: number, animate: boolean) => {
    stop();
    const strip = ref.current;
    const item = strip?.children[index]?.querySelector('button');
    if (!strip || !item) return;
    const outer = strip.getBoundingClientRect();
    const inner = item.getBoundingClientRect();
    const start = strip.scrollLeft;
    const target = photoStripTarget({
      scrollLeft: start,
      viewportWidth: strip.clientWidth,
      scrollWidth: strip.scrollWidth,
      itemLeft: inner.left - outer.left - strip.clientLeft + start,
      itemWidth: inner.width,
      gap: parseFloat(getComputedStyle(strip).columnGap) || 0,
    });
    if (Math.abs(target - start) < 1) return;
    if (!animate || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      strip.scrollLeft = target;
      return;
    }
    const started = performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, (now - started) / 200);
      strip.scrollLeft = start + (target - start) * (1 - (1 - progress) ** 3);
      frame.current = progress < 1 ? requestAnimationFrame(tick) : null;
    };
    frame.current = requestAnimationFrame(tick);
  }, [stop]);

  return {ref, follow, edges};
};
