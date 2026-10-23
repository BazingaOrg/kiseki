import {useEffect, useState} from 'react';
import {useTransitionPresence} from './useTransitionPresence';
import {Aperture} from 'lucide-react';

import {getRoll} from '../../film/src/index.mjs';
import {Darkroom} from './Darkroom';
import {overrideCount} from './film-state';
import type {AssetItem, FilmSettings} from './types';

interface FilmFieldProps {
  folder: string;
  photos: AssetItem[];
  settings: FilmSettings;
  onSettingsChange: (settings: FilmSettings) => void;
  locked: boolean;
}

export const FilmField = ({folder, photos, settings, onSettingsChange, locked}: FilmFieldProps) => {
  const [open, setOpen] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  const presence = useTransitionPresence(open, reducedMotion ? 0 : 180);
  const roll = settings.roll ? getRoll(settings.roll) : null;
  const overrides = overrideCount(settings, photos.map((photo) => photo.id));
  const summary = roll ? `整卷：${roll.name}${settings.strength < 1 ? ` · 强度 ${Math.round(settings.strength * 100)}%` : ''}` : '整卷：原片';

  return (
    <div className="make-field film-field">
      <span className="make-field-label">胶片</span>
      <div className="film-field-row">
        <span className="film-field-summary">
          {summary}
          {overrides > 0 ? <span className="film-field-extra">另有 {overrides} 张单独设置</span> : null}
        </span>
        <button type="button" className="film-button" disabled={locked || photos.length === 0} onClick={() => setOpen(true)}>
          <Aperture size={14} />
          挑胶片
        </button>
      </div>
      <p className="make-field-hint">视频和静态图共用这里的选择。随时可以改，原照片不会被修改。</p>
      {presence.present ? (
        <Darkroom
          visible={presence.visible}
          exiting={!open}
          onReopen={() => setOpen(true)}
          onExitEnd={presence.onTransitionEnd}
          folder={folder}
          photos={photos}
          settings={settings}
          onSettingsChange={onSettingsChange}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </div>
  );
};
