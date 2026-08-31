import type {TransitionSpec} from './types';

/** 返回会产生透明度淡化的过渡时长；硬切与无过渡均为 0。 */
export const getFadeDuration = (transition?: TransitionSpec | null): number =>
  transition?.type === 'album' || transition?.type === 'crossfade'
    ? transition.duration
    : 0;

export const resolvePhotoTransition = ({
  clipTransition,
  templateTransition,
  openingRecapFirst,
}: {
  clipTransition: TransitionSpec;
  templateTransition?: TransitionSpec;
  openingRecapFirst: boolean;
}): TransitionSpec => openingRecapFirst
  ? {type: 'none', duration: 0}
  : (templateTransition ?? clipTransition);
