/**
 * 「成果」区段:做出来的东西在这里看。
 *
 * 唯一的 <audio> 由这里持有(见 useAudioPlayer 的说明),播放条与歌词都是它的消费者,
 * 所以听歌和看歌词是同一次播放,不会各放各的。
 */
import {Pause, Play} from 'lucide-react';

import type {Capabilities, Remedy} from './capabilities';
import {Lyrics} from './Lyrics';
import {mediaUrl} from './media';
import {PhotoGrid} from './PhotoGrid';
import {Player} from './Player';
import type {ProjectResponse} from './types';
import {Blocked, Section} from './ui';
import {formatTime, useAudioPlayer} from './useAudioPlayer';

interface ResultsProps {
  project: ProjectResponse;
  capabilities: Capabilities;
  onRemedy: (target: Remedy['target']) => void;
}

export const Results = ({project, capabilities, onRemedy}: ResultsProps) => {
  const {audioProps, state, toggle, seek} = useAudioPlayer(
    project.audio ? mediaUrl(project.audio) : null,
  );

  const lyrics = project.lyrics ?? [];
  const photoCount = project.photos.length + project.output.stills.length;

  return (
    <>
      <Section title="成片" meta={project.output.videos.length > 0 ? `${project.output.videos.length} 份` : undefined}>
        {capabilities.playVideo.enabled ? (
          <Player videos={project.output.videos} />
        ) : (
          <Blocked capability={capabilities.playVideo} onRemedy={onRemedy} />
        )}
      </Section>

      <Section
        title="听歌"
        meta={project.lyricsSource === 'recognized' ? '歌词由本地识别，可能有出入' : undefined}
      >
        <audio {...audioProps} />
        {project.audio ? (
          <div className="audio-bar">
            <button
              className="audio-toggle"
              onClick={toggle}
              aria-label={state.playing ? '暂停' : '播放'}
            >
              {state.playing ? <Pause size={18} /> : <Play size={18} />}
            </button>
            <input
              className="audio-scrub"
              type="range"
              min={0}
              max={state.duration || 0}
              step={0.1}
              value={Math.min(state.currentTime, state.duration || 0)}
              onChange={(event) => seek(Number(event.target.value))}
              aria-label="播放进度"
            />
            <span className="audio-time">
              {formatTime(state.currentTime)} / {formatTime(state.duration)}
            </span>
          </div>
        ) : (
          <Blocked capability={capabilities.followLyrics} onRemedy={onRemedy} />
        )}

        {project.audio &&
          (capabilities.followLyrics.enabled ? (
            <Lyrics lyrics={lyrics} currentTime={state.currentTime} onSeek={seek} />
          ) : (
            <Blocked capability={capabilities.followLyrics} onRemedy={onRemedy} />
          ))}
      </Section>

      <Section title="照片" meta={photoCount > 0 ? `${photoCount} 张` : undefined}>
        {capabilities.browsePhotos.enabled ? (
          <PhotoGrid project={project} />
        ) : (
          <Blocked capability={capabilities.browsePhotos} onRemedy={onRemedy} />
        )}
      </Section>
    </>
  );
};
