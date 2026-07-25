import {useState} from 'react';

import {Lightbox} from './Lightbox';
import type {ProjectResponse} from './types';

interface PhotoGridProps {
  project: ProjectResponse;
}

export const PhotoGrid = ({project}: PhotoGridProps) => {
  const [activePhoto, setActivePhoto] = useState<string | null>(null);
  const stills = project.output.stills;

  return (
    <div className="photo-grid-view">
      <p className="project-path">{project.path}</p>

      {stills.length === 0 && <p className="hint">还没有导出的照片，先渲染一张吧。</p>}

      {stills.length > 0 && (
        <div className="photo-grid">
          {stills.map((stillPath) => (
            <button
              key={stillPath}
              className="photo-card"
              onClick={() => setActivePhoto(stillPath)}
            >
              <img src={`/media?path=${encodeURIComponent(stillPath)}`} alt="" loading="lazy" />
            </button>
          ))}
        </div>
      )}

      {activePhoto && (
        <Lightbox
          src={`/media?path=${encodeURIComponent(activePhoto)}`}
          onClose={() => setActivePhoto(null)}
        />
      )}
    </div>
  );
};
