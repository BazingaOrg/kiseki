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

export const photoCaptionPresentation = ({
  clips,
  frame,
  fps,
  showIntro,
  introEnd,
  recapEnd,
  durationInFrames,
  whiteFadeDuration = 2.5,
}: {
  clips: Array<{kind?: string; src?: string; caption?: string | null; captionLayout?: unknown; start: number; end: number}>;
  frame: number;
  fps: number;
  showIntro: boolean;
  introEnd: number;
  recapEnd: number;
  durationInFrames: number;
  whiteFadeDuration?: number;
}): {visible: boolean; opacity: number; clip: {kind?: string; src?: string; caption?: string | null; captionLayout?: unknown; start: number; end: number} | null} => {
  const whiteFadeStartFrame = Math.max(0, durationInFrames - Math.round(whiteFadeDuration * fps));
  const fadeFrames = Math.round(0.2 * fps);
  const bodyStart = Math.max(showIntro ? introEnd : 0, recapEnd);
  let winner: {index: number; startFrame: number; endFrame: number} | null = null;
  for (let index = 0; index < clips.length; index += 1) {
    const clip = clips[index];
    if (clip.kind === 'chapter' || typeof clip.src !== 'string') continue;
    const next = clips[index + 1];
    const startFrame = Math.ceil(Math.max(clip.start, bodyStart) * fps);
    const endCandidates = [Math.ceil(clip.end * fps), whiteFadeStartFrame];
    if (next) endCandidates.push(Math.ceil(next.start * fps));
    const endFrame = Math.min(...endCandidates);
    if (frame >= startFrame && frame < endFrame) {
      winner = {index, startFrame, endFrame};
    }
  }
  if (!winner) return {visible: false, opacity: 0, clip: null};
  const fadeIn = Math.min(1, Math.max(0, (frame - winner.startFrame) / Math.max(1, fadeFrames)));
  const fadeOut = Math.min(1, Math.max(0, (winner.endFrame - frame) / Math.max(1, fadeFrames)));
  return {
    visible: true,
    opacity: Math.min(fadeIn, fadeOut, 1),
    clip: clips[winner.index],
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
