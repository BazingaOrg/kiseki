import {useEffect, useRef, useState} from 'react';
import type {TransitionEvent} from 'react';

/** Keeps a lightweight panel mounted long enough for its exit transition. */
export const useTransitionPresence = (open: boolean, exitMs = 250) => {
  const [present, setPresent] = useState(open);
  const [visible, setVisible] = useState(open);
  const [generation, setGeneration] = useState(0);
  const desiredOpen = useRef(open);
  const previousOpen = useRef(open);
  const frame = useRef<number | null>(null);
  const timeout = useRef<number | null>(null);

  desiredOpen.current = open;

  const clearPending = () => {
    if (frame.current !== null) {
      cancelAnimationFrame(frame.current);
      frame.current = null;
    }
    if (timeout.current !== null) {
      window.clearTimeout(timeout.current);
      timeout.current = null;
    }
  };

  useEffect(() => {
    clearPending();

    if (open) {
      if (!previousOpen.current) setGeneration((value) => value + 1);
      previousOpen.current = true;
      setPresent(true);
      frame.current = requestAnimationFrame(() => {
        if (desiredOpen.current) setVisible(true);
      });
      return clearPending;
    }

    setVisible(false);
    previousOpen.current = false;
    timeout.current = window.setTimeout(() => {
      if (!desiredOpen.current) setPresent(false);
    }, exitMs);
    return clearPending;
  }, [exitMs, open]);

  const onTransitionEnd = (event: TransitionEvent<HTMLElement>) => {
    if (event.currentTarget !== event.target || event.propertyName !== 'opacity' || desiredOpen.current) return;
    clearPending();
    setPresent(false);
  };

  return {present, visible, generation, onTransitionEnd};
};
