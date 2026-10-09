import type {OpeningRecapSpec} from './types';

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

  const reversed = Array.from({length: Math.max(0, photoCount - 1)}, (_, index) => photoCount - 1 - index);
  const batchSize = 1;
  const slotCount = Math.max(1, Math.ceil(reversed.length / batchSize));
  const lastRewind = reversed.length === 0
    ? [0]
    : reversed.slice((slotCount - 1) * batchSize, slotCount * batchSize);
  if (frame >= settleFrame || photoCount === 1) {
    return {visible: true, settled: true, photoIndices: lastRewind, slotProgress: 1};
  }

  const rewindFrames = Math.max(1, settleFrame - startFrame);
  const localFrame = frame - startFrame;
  const slotIndex = Math.min(slotCount - 1, Math.floor(localFrame * slotCount / rewindFrames));
  const slotStart = Math.floor(slotIndex * rewindFrames / slotCount);
  const slotEnd = Math.max(slotStart + 1, Math.floor((slotIndex + 1) * rewindFrames / slotCount));
  const slotProgress = Math.min(1, Math.max(0, (localFrame - slotStart) / (slotEnd - slotStart)));
  return {
    visible: true,
    settled: false,
    photoIndices: reversed.slice(slotIndex * batchSize, (slotIndex + 1) * batchSize),
    slotProgress,
  };
};
