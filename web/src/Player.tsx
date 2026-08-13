/** 项目风格的原生视频控制层；解码与媒体语义仍由 HTMLVideoElement 提供。 */
import {useEffect, useRef, useState} from 'react';
import type {CSSProperties, ReactNode, SyntheticEvent} from 'react';
import {Maximize, Minimize, Pause, PictureInPicture, Play, RotateCcw, RotateCw, Volume2, VolumeX} from 'lucide-react';

import {mediaUrl} from './media';
import {MediaTimeline} from './MediaTimeline';
import {useMediaPlayer} from './useMediaPlayer';

interface WebkitVideo extends HTMLVideoElement {
  webkitEnterFullscreen?: () => void;
}

const isEditableTarget = (target: EventTarget | null) => target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLButtonElement || (target instanceof HTMLElement && target.isContentEditable);

const ControlButton = ({label, onClick, children, disabled = false}: {label: string; onClick: () => void; children: ReactNode; disabled?: boolean}) => (
  <button className="media-control-button" type="button" onClick={onClick} disabled={disabled} aria-label={label} title={label}>
    {children}
  </button>
);

export const Player = ({video}: {video: string | null}) => {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [customControlsReady, setCustomControlsReady] = useState(false);
  const [loadedVideo, setLoadedVideo] = useState<string | null>(null);
  const [aspectRatio, setAspectRatio] = useState(16 / 9);
  const [pictureInPictureAvailable, setPictureInPictureAvailable] = useState(false);
  const [isPictureInPicture, setIsPictureInPicture] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const controlsTimerRef = useRef<number | null>(null);
  const {mediaRef, mediaProps, state, toggle, seekTo, seekBy, setVolume, toggleMute} = useMediaPlayer<HTMLVideoElement>(video ? mediaUrl(video) : null, 'auto');

  useEffect(() => {
    setCustomControlsReady(true);
  }, []);

  useEffect(() => {
    if (controlsTimerRef.current !== null) window.clearTimeout(controlsTimerRef.current);
    setControlsVisible(true);
    if (isFullscreen && state.playing) {
      controlsTimerRef.current = window.setTimeout(() => setControlsVisible(false), 2800);
    }
    return () => {
      if (controlsTimerRef.current !== null) window.clearTimeout(controlsTimerRef.current);
    };
  }, [isFullscreen, state.playing]);

  useEffect(() => {
    const media = mediaRef.current;
    if (!media) return;
    setPictureInPictureAvailable(Boolean(document.pictureInPictureEnabled && typeof media.requestPictureInPicture === 'function'));
    const onEnter = () => setIsPictureInPicture(true);
    const onLeave = () => setIsPictureInPicture(false);
    media.addEventListener('enterpictureinpicture', onEnter);
    media.addEventListener('leavepictureinpicture', onLeave);
    return () => {
      media.removeEventListener('enterpictureinpicture', onEnter);
      media.removeEventListener('leavepictureinpicture', onLeave);
    };
  }, [mediaRef, video]);

  useEffect(() => {
    const onFullscreenChange = () => setIsFullscreen(document.fullscreenElement === wrapperRef.current);
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);

  if (!video) return null;

  const mediaReady = loadedVideo === video;
  const playerStyle = {
    '--player-video-aspect-ratio': aspectRatio,
    '--player-video-max-width': `min(${60 * aspectRatio}vh, ${600 * aspectRatio}px)`,
  } as CSSProperties;

  const handleLoadedMetadata = (event: SyntheticEvent<HTMLVideoElement>) => {
    mediaProps.onLoadedMetadata(event);
    const {videoWidth, videoHeight} = event.currentTarget;
    if (videoWidth > 0 && videoHeight > 0) setAspectRatio(videoWidth / videoHeight);
  };

  const handleLoadedData = (event: SyntheticEvent<HTMLVideoElement>) => {
    mediaProps.onLoadedData(event);
    setLoadedVideo(video);
  };

  const togglePictureInPicture = () => {
    const media = mediaRef.current;
    if (!media) return;
    if (document.pictureInPictureElement) void document.exitPictureInPicture().catch(() => undefined);
    else if (typeof media.requestPictureInPicture === 'function') void media.requestPictureInPicture().catch(() => undefined);
  };

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
      return;
    }
    const wrapper = wrapperRef.current;
    const media = mediaRef.current as WebkitVideo | null;
    if (wrapper?.requestFullscreen) void wrapper.requestFullscreen().catch(() => undefined);
    else media?.webkitEnterFullscreen?.();
  };

  const revealControls = () => {
    setControlsVisible(true);
    if (controlsTimerRef.current !== null) window.clearTimeout(controlsTimerRef.current);
    if (isFullscreen && state.playing) {
      controlsTimerRef.current = window.setTimeout(() => setControlsVisible(false), 2800);
    }
  };

  return (
    <div
      ref={wrapperRef}
      className={controlsVisible ? 'player' : 'player player-controls-hidden'}
      style={playerStyle}
      tabIndex={0}
      aria-label="成片播放器"
      onPointerMove={revealControls}
      onPointerDown={revealControls}
      onKeyDown={(event) => {
        if (isEditableTarget(event.target)) return;
        revealControls();
        if (event.key === ' ' || event.key.toLowerCase() === 'k') {
          event.preventDefault();
          toggle();
        } else if (event.key === 'ArrowLeft') {
          event.preventDefault();
          seekBy(-5);
        } else if (event.key === 'ArrowRight') {
          event.preventDefault();
          seekBy(5);
        } else if (event.key.toLowerCase() === 'm') {
          event.preventDefault();
          toggleMute();
        } else if (event.key.toLowerCase() === 'f') {
          event.preventDefault();
          toggleFullscreen();
        }
      }}
    >
      {/* 挂载前保留原生 controls，确保自定义层未就绪时仍有可用的播放路径。 */}
      <div className="player-media-stage">
        <video
          key={video}
          {...mediaProps}
          className={mediaReady ? 'player-video player-video-ready' : 'player-video'}
          controls={!customControlsReady}
          playsInline
          onLoadedMetadata={handleLoadedMetadata}
          onLoadedData={handleLoadedData}
        />
        {!mediaReady && <span className="media-loading" role="status">正在加载视频</span>}
      </div>
      <div className="video-controls" aria-label="成片控制">
        <ControlButton label={state.playing ? '暂停（空格 / K）' : '播放（空格 / K）'} onClick={toggle}>
          {state.playing ? <Pause aria-hidden="true" size={18} /> : <Play aria-hidden="true" size={18} />}
        </ControlButton>
        <ControlButton label="后退 5 秒（←）" onClick={() => seekBy(-5)}><RotateCcw aria-hidden="true" size={17} /></ControlButton>
        <ControlButton label="前进 5 秒（→）" onClick={() => seekBy(5)}><RotateCw aria-hidden="true" size={17} /></ControlButton>
        <MediaTimeline currentTime={state.currentTime} duration={state.duration} buffered={state.buffered} onSeek={seekTo} />
        <ControlButton label={state.muted || state.volume === 0 ? '取消静音（M）' : '静音（M）'} onClick={toggleMute}>
          {state.muted || state.volume === 0 ? <VolumeX aria-hidden="true" size={17} /> : <Volume2 aria-hidden="true" size={17} />}
        </ControlButton>
        <input className="media-volume" type="range" min={0} max={1} step={0.05} value={state.muted ? 0 : state.volume} onChange={(event) => setVolume(Number(event.target.value))} aria-label="音量" aria-valuetext={`${Math.round((state.muted ? 0 : state.volume) * 100)}%`} />
        {pictureInPictureAvailable && <ControlButton label={isPictureInPicture ? '退出画中画' : '画中画'} onClick={togglePictureInPicture}><PictureInPicture aria-hidden="true" size={17} /></ControlButton>}
        <ControlButton label={isFullscreen ? '退出全屏（F）' : '全屏（F）'} onClick={toggleFullscreen}>
          {isFullscreen ? <Minimize aria-hidden="true" size={17} /> : <Maximize aria-hidden="true" size={17} />}
        </ControlButton>
      </div>
      {state.status === 'buffering' && <span className="media-buffering" role="status">正在缓冲</span>}
      {state.error && <p className="media-error" role="alert">{state.error}</p>}
    </div>
  );
};
