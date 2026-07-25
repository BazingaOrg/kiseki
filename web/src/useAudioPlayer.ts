/**
 * 一个素材夹只有一首歌,所以整个工作台只该有一个 <audio> 元素。
 *
 * 阶段四曾让 Player 与 Lyrics 各持一个 <audio>,切换视图时进度归零;三段式布局下
 * 播放器与歌词可能同屏,两个音源会直接叠着响。播放状态因此上提到这个 hook,
 * 由「成果」区段统一持有,播放器与歌词都只是它的消费者。
 */
import {useCallback, useEffect, useRef, useState} from 'react';

export interface AudioPlayerState {
  currentTime: number;
  duration: number;
  playing: boolean;
}

export const formatTime = (seconds: number): string => {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

export const useAudioPlayer = (src: string | null) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [state, setState] = useState<AudioPlayerState>({currentTime: 0, duration: 0, playing: false});

  // 换歌(切素材夹)时把进度归零,否则新歌会带着上一首的播放位置显示
  useEffect(() => {
    setState({currentTime: 0, duration: 0, playing: false});
  }, [src]);

  const toggle = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    // 播放可能被浏览器策略拒绝(未交互、解码不可用),吞掉 rejection 即可,
    // playing 状态由 onPlay/onPause 事件回填,不在这里乐观更新
    if (audio.paused) void audio.play().catch(() => undefined);
    else audio.pause();
  }, []);

  const seek = useCallback((seconds: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = seconds;
    setState((prev) => ({...prev, currentTime: seconds}));
  }, []);

  const audioProps = {
    ref: audioRef,
    src: src ?? undefined,
    preload: 'metadata' as const,
    onTimeUpdate: (event: React.SyntheticEvent<HTMLAudioElement>) =>
      setState((prev) => ({...prev, currentTime: event.currentTarget.currentTime})),
    onLoadedMetadata: (event: React.SyntheticEvent<HTMLAudioElement>) =>
      setState((prev) => ({...prev, duration: event.currentTarget.duration})),
    onPlay: () => setState((prev) => ({...prev, playing: true})),
    onPause: () => setState((prev) => ({...prev, playing: false})),
    onEnded: () => setState((prev) => ({...prev, playing: false})),
  };

  return {audioProps, state, toggle, seek};
};
