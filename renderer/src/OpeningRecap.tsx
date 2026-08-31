import React from 'react';
import {AbsoluteFill, Img, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import {FramedPhoto} from './FramedPhoto';
import {hashString} from './motion';
import {openingRecapFrameState} from './openingRecapTiming';
import {getVisualScale, type Palette} from './theme';
import type {PhotoClip, TimelineMeta} from './types';

export type OpeningRecapVariant = 'diary' | 'cut' | 'filmstrip' | 'polaroid';

const toStatic = (src: string) => staticFile(src.replace(/^\.\//, ''));

const PolaroidCard: React.FC<{
  clip: PhotoClip;
  maxWidth: number;
  maxHeight: number;
  padding: number;
  scale: number;
  rotation: number;
}> = ({clip, maxWidth, maxHeight, padding, scale, rotation}) => (
  <div
    style={{
      transform: `rotate(${rotation}deg)`,
      background: '#fff',
      padding: Math.round(padding),
      borderRadius: Math.round(4 * scale),
      boxShadow: '0 14px 36px rgba(10, 12, 16, 0.26)',
    }}
  >
    <Img
      src={toStatic(clip.src)}
      style={{display: 'block', maxWidth, maxHeight, objectFit: 'contain', background: '#000'}}
    />
  </div>
);

export const OpeningRecap: React.FC<{
  meta: TimelineMeta;
  photos: PhotoClip[];
  palette: Palette;
  variant: OpeningRecapVariant;
}> = ({meta, photos, palette, variant}) => {
  const frame = useCurrentFrame();
  const {fps, width, height} = useVideoConfig();
  const spec = meta.opening_recap;
  if (!spec) return null;

  const state = openingRecapFrameState({frame, fps, photoCount: photos.length, spec});
  if (!state.visible) return null;
  if (state.settled && (variant === 'diary' || variant === 'cut')) return null;

  const clips = state.photoIndices.map((index) => photos[index]).filter((clip): clip is PhotoClip => clip !== undefined);
  const scale = getVisualScale(width, height);
  const entry = state.settled ? 0 : 1 - Math.min(1, state.slotProgress * 2.5);
  const activeHash = clips[0] ? hashString(clips[0].src) : 0;
  const direction = activeHash % 2 === 0 ? -1 : 1;
  const motionStyle: React.CSSProperties = variant === 'cut' || entry === 0
    ? {}
    : {
        transform: `translateY(${direction * entry * 3 * scale}px) scale(${1 + entry * 0.008})`,
        filter: `blur(${entry * 0.8 * scale}px) brightness(${1 + entry * 0.04})`,
      };

  if (spec.layout === 'grid' && !state.settled) {
    const columns = Math.ceil(Math.sqrt(spec.batch_size));
    const gridWidth = width * 0.74;
    const gridHeight = height * 0.7;
    const gap = 18 * scale;
    const cellWidth = (gridWidth - gap * (columns - 1)) / columns;
    const cellHeight = (gridHeight - gap * (columns - 1)) / columns;
    return (
      <AbsoluteFill style={{backgroundColor: meta.background, justifyContent: 'center', alignItems: 'center'}}>
        <div
          style={{
            ...motionStyle,
            width: gridWidth,
            height: gridHeight,
            display: 'grid',
            gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
            gridTemplateRows: `repeat(${columns}, minmax(0, 1fr))`,
            gap,
          }}
        >
          {clips.map((clip) => (
            <div key={clip.src} style={{display: 'flex', justifyContent: 'center', alignItems: 'center', minWidth: 0, minHeight: 0}}>
              {variant === 'polaroid' ? (
                <PolaroidCard
                  clip={clip}
                  maxWidth={cellWidth * 0.82}
                  maxHeight={cellHeight * 0.78}
                  padding={cellWidth * 0.03}
                  scale={scale}
                  rotation={(hashString(clip.src) % 7) - 3}
                />
              ) : (
                <FramedPhoto
                  src={toStatic(clip.src)}
                  maxWidth={cellWidth}
                  maxHeight={cellHeight}
                  renderScale={scale}
                  palette={palette}
                  filter={clip.filter ?? meta.filter}
                />
              )}
            </div>
          ))}
        </div>
      </AbsoluteFill>
    );
  }

  const clip = clips[0];
  if (!clip) return null;

  if (variant === 'polaroid') {
    const safeWidth = meta.width * meta.photo_scale;
    const safeHeight = meta.height * meta.photo_scale;
    const rotation = (hashString(clip.src) % 9) - 4 + direction * entry * 3;
    return (
      <AbsoluteFill style={{backgroundColor: meta.background, justifyContent: 'center', alignItems: 'center'}}>
        <div style={entry === 0 ? undefined : {filter: `blur(${entry * 0.8 * scale}px) brightness(${1 + entry * 0.04})`}}>
          <PolaroidCard
            clip={clip}
            maxWidth={safeWidth * 0.9}
            maxHeight={safeHeight * 0.9}
            padding={safeWidth * 0.03}
            scale={scale}
            rotation={rotation}
          />
        </div>
      </AbsoluteFill>
    );
  }

  if (variant === 'filmstrip') {
    const mainScale = meta.photo_scale * 0.92;
    const stripHeight = height * 0.09;
    const activeIndex = state.photoIndices[0] ?? 0;
    const stripIndices = state.settled
      ? [0, 1]
      : [activeIndex + 1, activeIndex, activeIndex - 1];
    const strip = stripIndices.map((index) => photos[index]).filter((item): item is PhotoClip => item !== undefined);
    return (
      <AbsoluteFill style={{backgroundColor: meta.background}}>
        <AbsoluteFill style={{...motionStyle, justifyContent: 'center', alignItems: 'center'}}>
          <Img
            src={toStatic(clip.src)}
            style={{
              display: 'block',
              maxWidth: meta.width * mainScale,
              maxHeight: meta.height * mainScale,
              objectFit: 'contain',
              borderRadius: Math.round(3 * scale),
              boxShadow: '0 14px 36px rgba(10, 12, 16, 0.22)',
            }}
          />
        </AbsoluteFill>
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            height: stripHeight,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: Math.round(10 * scale),
            background: 'rgba(10, 12, 16, 0.35)',
          }}
        >
          {strip.map((item) => {
            const current = item === clip;
            return (
              <Img
                key={item.src}
                src={toStatic(item.src)}
                style={{
                  display: 'block',
                  height: stripHeight * 0.72,
                  maxWidth: width * 0.24,
                  objectFit: 'contain',
                  opacity: current ? 1 : 0.55,
                  borderRadius: Math.round(2 * scale),
                  boxShadow: current ? `0 0 0 2px ${palette.text}` : 'none',
                }}
              />
            );
          })}
        </div>
      </AbsoluteFill>
    );
  }

  return (
    <AbsoluteFill style={{backgroundColor: meta.background, justifyContent: 'center', alignItems: 'center'}}>
      <div style={motionStyle}>
        <FramedPhoto
          src={toStatic(clip.src)}
          maxWidth={meta.width * meta.photo_scale}
          maxHeight={meta.height * meta.photo_scale}
          renderScale={scale}
          palette={palette}
          filter={clip.filter ?? meta.filter}
        />
      </div>
    </AbsoluteFill>
  );
};
