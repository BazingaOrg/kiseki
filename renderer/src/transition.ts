import type {TransitionSpec} from './types';

/** 返回会产生透明度淡化的过渡时长；硬切与无过渡均为 0。 */
export const getFadeDuration = (transition?: TransitionSpec | null): number =>
  transition?.type === 'album' || transition?.type === 'crossfade'
    ? transition.duration
    : 0;

/** 交叉淡化以切换时刻为中点。相册淡入从切换时刻开始。 */
export const fadeLead = (transition?: TransitionSpec | null): number => {
  const duration = getFadeDuration(transition);
  return transition?.type === 'crossfade' ? duration / 2 : 0;
};

/** 新照片从透明到不透明的时间区间。硬切返回 null。 */
export const fadeRange = (transition: TransitionSpec | null | undefined, start: number): [number, number] | null => {
  const duration = getFadeDuration(transition);
  if (duration <= 0) return null;
  const from = start - fadeLead(transition);
  return [from, from + duration];
};

/** 旧照片需覆盖到新照片完全不透明的时刻。 */
export const coverUntil = (nextTransition: TransitionSpec | null | undefined, end: number): number => {
  const duration = getFadeDuration(nextTransition);
  return end + duration - fadeLead(nextTransition);
};

/** 淡化结束后至少留下的完全可见时间。短于这段的停留改为硬切。 */
export const MIN_PHOTO_SETTLED = 0.12;

/** 淡化不超过停留减去停稳时间，避免短照片一直半透明。 */
export const fitFadeDuration = (duration: number, hold: number): number => {
  if (!(duration > 0) || !(hold > MIN_PHOTO_SETTLED)) return 0;
  return Math.min(duration, hold - MIN_PHOTO_SETTLED);
};

export const fitPhotoTransition = (transition: TransitionSpec | null | undefined, hold: number): TransitionSpec => {
  if (!transition || (transition.type !== 'album' && transition.type !== 'crossfade')) {
    return transition ?? {type: 'none', duration: 0};
  }
  const duration = fitFadeDuration(transition.duration, hold);
  if (duration <= 0) return {type: 'cut', duration: 0};
  return {...transition, duration};
};

export const resolvePhotoTransition = ({
  clipTransition,
  templateTransition,
  openingRecapFirst,
}: {
  clipTransition: TransitionSpec;
  templateTransition?: TransitionSpec;
  openingRecapFirst: boolean;
  openingRecapFade?: number;
}): TransitionSpec => openingRecapFirst
  ? {type: 'none', duration: 0}
  : (templateTransition ?? clipTransition);
