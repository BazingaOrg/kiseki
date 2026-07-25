import {useState} from 'react';

import type {ProjectResponse} from './types';

interface PlayerProps {
  project: ProjectResponse;
}

export const Player = ({project}: PlayerProps) => {
  const videos = project.output.videos;
  const [activeVideo, setActiveVideo] = useState<string | null>(videos[0] ?? null);

  const hasVideos = videos.length > 0;
  const hasAudio = project.audio !== null;

  if (!hasVideos && !hasAudio) {
    return <p className="hint">还没有可播放的内容，先渲染一段吧。</p>;
  }

  return (
    <div className="player-view">
      {!hasVideos && (
        <p className="hint">还没有渲染好的成片。</p>
      )}

      {hasVideos && (
        <div className="player-section">
          {videos.length > 1 && (
            <ul className="video-list">
              {videos.map((videoPath) => (
                <li key={videoPath}>
                  <button
                    className={videoPath === activeVideo ? 'video-item video-item-active' : 'video-item'}
                    onClick={() => setActiveVideo(videoPath)}
                  >
                    {videoPath.split('/').pop()}
                  </button>
                </li>
              ))}
            </ul>
          )}

          {activeVideo && (
            <video controls src={`/media?path=${encodeURIComponent(activeVideo)}`} className="player-video" />
          )}
        </div>
      )}

      {hasAudio && (
        <div className="player-section">
          <audio controls src={`/media?path=${encodeURIComponent(project.audio as string)}`} />
        </div>
      )}
    </div>
  );
};
