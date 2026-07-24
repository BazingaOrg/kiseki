import React from 'react';
import {Img} from 'remotion';
import {getFilter} from './filters';
import {PHOTO, getPhotoShadow, type Palette} from './theme';

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
  /** 可选滤镜覆盖;id 见 filters.ts 注册表,缺省不应用滤镜 */
  filter?: {id: string; intensity?: number} | null;
}> = ({src, maxWidth, maxHeight, renderScale, palette, filter}) => {
  const outlineWidth = PHOTO.outlineWidth * renderScale;
  const boxShadow = React.useMemo(() => getPhotoShadow(renderScale, palette), [renderScale, palette]);
  const resolvedFilter = React.useMemo(
    () => getFilter(filter?.id, filter?.intensity),
    [filter?.id, filter?.intensity],
  );

  const imgNode = (
    <Img
      src={src}
      style={{
        maxWidth,
        maxHeight,
        width: 'auto',
        height: 'auto',
        boxShadow,
        outline: `${outlineWidth}px solid ${palette.photoOutline}`,
        outlineOffset: `${-outlineWidth}px`,
        ...resolvedFilter.imgStyle,
      }}
    />
  );

  if (!resolvedFilter.svgDefMarkup && !resolvedFilter.overlayStyle && Object.keys(resolvedFilter.imgStyle).length === 0) {
    return imgNode;
  }

  return (
    <div style={{position: 'relative', display: 'inline-flex'}}>
      {resolvedFilter.svgDefMarkup ? (
        <svg width={0} height={0} style={{position: 'absolute'}} aria-hidden="true">
          <defs dangerouslySetInnerHTML={{__html: resolvedFilter.svgDefMarkup}} />
        </svg>
      ) : null}
      {imgNode}
      {resolvedFilter.overlayStyle ? (
        <div style={{position: 'absolute', inset: 0, pointerEvents: 'none', ...resolvedFilter.overlayStyle}} />
      ) : null}
    </div>
  );
};
