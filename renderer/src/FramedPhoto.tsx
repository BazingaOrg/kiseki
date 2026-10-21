import React from 'react';
import {FilmImg, type GrainMode} from './film';
import {PHOTO, getPhotoShadow, type Palette} from './theme';
import type {PhotoFilm} from './types';

/**
 * 展陈框照片:Img + 1px 描边 + 三层阴影。视频 Photo 与 still 共用,视觉只改一处。
 */
export const FramedPhoto: React.FC<{
  src: string;
  maxWidth: number;
  maxHeight: number;
  /** 短边/1080,阴影与描边等比缩放 */
  renderScale: number;
  palette: Palette;
  film?: PhotoFilm | null;
  grain?: GrainMode;
}> = ({src, maxWidth, maxHeight, renderScale, palette, film, grain}) => {
  const outlineWidth = PHOTO.outlineWidth * renderScale;
  const boxShadow = React.useMemo(() => getPhotoShadow(renderScale, palette), [renderScale, palette]);

  return (
    <FilmImg
      src={src}
      film={film}
      grain={grain}
      style={{
        maxWidth,
        maxHeight,
        width: 'auto',
        height: 'auto',
        boxShadow,
        outline: `${outlineWidth}px solid ${palette.photoOutline}`,
        outlineOffset: `${-outlineWidth}px`,
      }}
    />
  );
};
