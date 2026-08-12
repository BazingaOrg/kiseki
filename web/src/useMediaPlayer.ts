import {useCallback, useEffect, useRef, useState} from 'react';
import type {SyntheticEvent} from 'react';

export type MediaStatus = 'idle' | 'loading' | 'ready' | 'buffering' | 'error';

export interface MediaPlayerState {
  status: MediaStatus;
  currentTime: number;
  duration: number;
  buffered: number;
  playing: boolean;
  volume: number;
  muted: boolean;
  error: string | null;
}

export const formatTime = (seconds: number): string => {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainder = String(total % 60).padStart(2, '0');
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${remainder}` : `${minutes}:${remainder}`;
};

const getBufferedEnd = (media: HTMLMediaElement): number => {
  if (!media.buffered.length || !Number.isFinite(media.duration) || media.duration <= 0) return 0;
  return Math.min(media.buffered.end(media.buffered.length - 1), media.duration);
};

/** A narrow native-media bridge. Browser events, rather than commands, own playback state. */
export const useMediaPlayer = <T extends HTMLMediaElement>(src: string | null, preload: 'metadata' | 'auto' = 'metadata') => {
  const mediaRef = useRef<T | null>(null);
  const waitingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [state, setState] = useState<MediaPlayerState>({
    status: src ? 'loading' : 'idle', currentTime: 0, duration: 0, buffered: 0,
    playing: false, volume: 1, muted: false, error: null,
  });

  const clearWaiting = useCallback(() => {
    if (waitingTimer.current) clearTimeout(waitingTimer.current);
    waitingTimer.current = null;
  }, []);

  useEffect(() => {
    clearWaiting();
    const media = mediaRef.current;
    if (!src && media) {
      media.pause();
      media.removeAttribute('src');
      media.load();
    }
    setState({status: src ? 'loading' : 'idle', currentTime: 0, duration: 0, buffered: 0, playing: false, volume: 1, muted: false, error: null});
    return clearWaiting;
  }, [src, clearWaiting]);

  const toggle = useCallback(() => {
    const media = mediaRef.current;
    if (!media) return;
    if (media.paused) void media.play().catch(() => undefined);
    else media.pause();
  }, []);

  const seekTo = useCallback((seconds: number) => {
    const media = mediaRef.current;
    if (!media || !Number.isFinite(seconds)) return;
    const next = Math.max(0, Math.min(seconds, Number.isFinite(media.duration) ? media.duration : seconds));
    media.currentTime = next;
    setState((previous) => ({...previous, currentTime: next}));
  }, []);

  const seekBy = useCallback((seconds: number) => {
    const media = mediaRef.current;
    if (media) seekTo(media.currentTime + seconds);
  }, [seekTo]);

  const setVolume = useCallback((volume: number) => {
    const media = mediaRef.current;
    if (!media) return;
    media.volume = Math.max(0, Math.min(volume, 1));
  }, []);

  const toggleMute = useCallback(() => {
    const media = mediaRef.current;
    if (media) media.muted = !media.muted;
  }, []);

  const onMediaEvent = useCallback((event: SyntheticEvent<T>) => {
    const media = event.currentTarget;
    switch (event.type) {
      case 'loadedmetadata':
      case 'durationchange':
        setState((previous) => ({...previous, duration: Number.isFinite(media.duration) ? media.duration : 0, buffered: getBufferedEnd(media)}));
        break;
      case 'timeupdate':
        setState((previous) => ({...previous, currentTime: media.currentTime, buffered: getBufferedEnd(media)}));
        break;
      case 'progress':
        setState((previous) => ({...previous, buffered: getBufferedEnd(media)}));
        break;
      case 'play':
      case 'playing':
      case 'loadeddata':
      case 'canplay':
        clearWaiting();
        setState((previous) => ({...previous, status: 'ready', playing: !media.paused}));
        break;
      case 'pause':
      case 'ended':
        clearWaiting();
        setState((previous) => ({...previous, playing: false}));
        break;
      case 'volumechange':
        setState((previous) => ({...previous, volume: media.volume, muted: media.muted}));
        break;
      case 'waiting':
      case 'stalled':
        clearWaiting();
        waitingTimer.current = setTimeout(() => setState((previous) => previous.playing ? {...previous, status: 'buffering'} : previous), 200);
        break;
      case 'error':
        clearWaiting();
        setState((previous) => ({...previous, status: 'error', playing: false, error: '此媒体无法播放，请检查文件格式或在系统播放器中打开。'}));
        break;
    }
  }, [clearWaiting]);

  const mediaProps = {
    ref: mediaRef,
    src: src ?? undefined,
    preload,
    onLoadedMetadata: onMediaEvent, onLoadedData: onMediaEvent, onDurationChange: onMediaEvent, onTimeUpdate: onMediaEvent,
    onProgress: onMediaEvent, onPlay: onMediaEvent, onPause: onMediaEvent, onVolumeChange: onMediaEvent,
    onWaiting: onMediaEvent, onStalled: onMediaEvent, onPlaying: onMediaEvent, onCanPlay: onMediaEvent,
    onError: onMediaEvent, onEnded: onMediaEvent,
  };

  return {mediaRef, mediaProps, state, toggle, seekTo, seekBy, setVolume, toggleMute};
};
