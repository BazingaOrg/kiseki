const clamp01 = (value: number): number => Math.min(Math.max(value, 0), 1);

const progressBetween = (time: number, start: number, end: number): number =>
  end > start ? clamp01((time - start) / (end - start)) : time >= end ? 1 : 0;

export const filmstripLayerPresentation = ({
  time,
  start,
  end,
  nextPhotoStart,
  transitionDuration,
}: {
  time: number;
  start: number;
  end: number;
  nextPhotoStart: number | null;
  transitionDuration: number;
}) => {
  const halfTransition = transitionDuration / 2;
  const visibleUntil = nextPhotoStart === null ? end : nextPhotoStart + halfTransition;
  return {
    visible: time >= start - halfTransition && time <= visibleUntil,
    opacity: progressBetween(time, start - halfTransition, start + halfTransition),
  };
};

export const polaroidCardPresentation = ({
  time,
  start,
  end,
  nextPhotoStart,
  rotation,
}: {
  time: number;
  start: number;
  end: number;
  nextPhotoStart: number | null;
  rotation: number;
}) => {
  const exitStart = nextPhotoStart ?? Math.max(start, end - 0.3);
  const exitEnd = nextPhotoStart === null ? end : nextPhotoStart + 0.3;
  const fadeIn = progressBetween(time, start, start + 0.2);
  const fadeOut = 1 - progressBetween(time, exitStart, exitEnd);
  const settle = progressBetween(time, start, start + 0.4);
  return {
    visible: time >= start && time <= exitEnd,
    opacity: Math.min(fadeIn, fadeOut),
    rotation: rotation + 10 * (1 - settle),
  };
};
