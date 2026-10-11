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
