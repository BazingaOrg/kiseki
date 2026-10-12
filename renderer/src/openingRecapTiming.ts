import type {OpeningRecapSpec} from './types';

const MIN_REWIND_SLOT_FRAMES = 4;

const rewindSamples = (reversed: number[], slotCount: number): number[] => {
  if (slotCount >= reversed.length) return reversed;
  if (slotCount <= 1) return [reversed[reversed.length - 1] ?? 0];
  const picked = Array.from({length: slotCount}, (_, slot) => {
    const index = Math.round((slot * (reversed.length - 1)) / (slotCount - 1));
    return reversed[index];
  });
  const sequence: number[] = [];
  for (const index of picked) {
    if (sequence[sequence.length - 1] !== index) sequence.push(index);
  }
  return sequence;
};

export type OpeningRecapFrameState = {
  visible: boolean;
  settled: boolean;
  photoIndices: number[];
  slotProgress: number;
};

export const openingRecapFrameBounds = ({fps, spec}: {fps: number; spec: OpeningRecapSpec}) => {
  const startFrame = Math.ceil(spec.start * fps);
  const endFrame = Math.ceil(spec.end * fps);
  return {
    startFrame,
    endFrame,
    settleFrame: Math.min(Math.ceil(spec.settle_start * fps), endFrame - 1),
  };
};

export const openingRecapFrameState = ({
  frame,
  fps,
  photoCount,
  spec,
  stacked = false,
}: {
  frame: number;
  fps: number;
  photoCount: number;
  spec: OpeningRecapSpec;
  stacked?: boolean;
}): OpeningRecapFrameState => {
  const {startFrame, endFrame, settleFrame} = openingRecapFrameBounds({fps, spec});
  if (frame < startFrame || frame >= endFrame || photoCount === 0) {
    return {visible: false, settled: false, photoIndices: [], slotProgress: 0};
  }

  const reversed = Array.from({length: photoCount}, (_, index) => photoCount - 1 - index);
  const rewindFrames = Math.max(1, settleFrame - startFrame);
  const sequence = rewindSamples(
    reversed,
    Math.min(reversed.length, Math.max(1, Math.floor(rewindFrames / MIN_REWIND_SLOT_FRAMES))),
  );
  const slotCount = Math.max(1, sequence.length);
  const held = sequence[sequence.length - 1] ?? 0;
  if (frame >= settleFrame || photoCount === 1) {
    return {visible: true, settled: true, photoIndices: [held], slotProgress: 1};
  }

  const localFrame = frame - startFrame;
  const slotIndex = Math.min(slotCount - 1, Math.floor(localFrame * slotCount / rewindFrames));
  const slotStart = Math.floor(slotIndex * rewindFrames / slotCount);
  const slotEnd = Math.max(slotStart + 1, Math.floor((slotIndex + 1) * rewindFrames / slotCount));
  const slotProgress = Math.min(1, Math.max(0, (localFrame - slotStart) / (slotEnd - slotStart)));
  return {
    visible: true,
    settled: false,
    photoIndices: [sequence[slotIndex] ?? held],
    slotProgress,
  };
};
