import type {LyricLine} from './types';

const MAX_ACTIVE_LYRIC_SECONDS = 8;

export const findActiveLine = (lyrics: LyricLine[], currentTime: number): number => {
  let index = -1;
  for (let i = 0; i < lyrics.length; i += 1) {
    if (lyrics[i].time <= currentTime) index = i;
    else break;
  }
  if (index < 0) return -1;
  const until = Math.min(lyrics[index].until ?? Infinity, lyrics[index].time + MAX_ACTIVE_LYRIC_SECONDS);
  return currentTime >= until ? -1 : index;
};
