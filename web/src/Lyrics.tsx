import {useEffect, useRef, useState} from 'react';

import type {ProjectResponse} from './types';

interface LyricsProps {
  project: ProjectResponse;
}

export const Lyrics = ({project}: LyricsProps) => {
  const lyrics = project.lyrics;
  const [currentTime, setCurrentTime] = useState(0);
  const lineRefs = useRef<Array<HTMLLIElement | null>>([]);

  const currentIndex = (() => {
    if (!lyrics) return -1;
    let index = -1;
    for (let i = 0; i < lyrics.length; i += 1) {
      if (lyrics[i].time <= currentTime) index = i;
    }
    return index;
  })();

  useEffect(() => {
    if (currentIndex < 0) return;
    const el = lineRefs.current[currentIndex];
    if (el) el.scrollIntoView({block: 'center', behavior: 'smooth'});
  }, [currentIndex]);

  if (!lyrics || lyrics.length === 0) {
    return <p className="hint">还没有歌词。</p>;
  }

  return (
    <div className="lyrics-view">
      {project.audio && (
        <audio
          controls
          src={`/media?path=${encodeURIComponent(project.audio)}`}
          onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
        />
      )}

      <ul className="lyrics-list">
        {lyrics.map((line, index) => (
          <li
            key={`${line.time}-${index}`}
            ref={(el) => {
              lineRefs.current[index] = el;
            }}
            className={index === currentIndex ? 'lyric-line lyric-line-active' : 'lyric-line'}
          >
            {line.text}
          </li>
        ))}
      </ul>
    </div>
  );
};
