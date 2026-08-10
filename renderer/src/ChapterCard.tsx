import React from 'react';
import {AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig} from 'remotion';
import {FONT_FAMILY, getVisualScale, type FontFamily, type Palette} from './theme';
import type {ChapterClip} from './types';
import type {TemplateChapterCardStyle} from './templates';

const clamp = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;

// 缺省呈现(与无模板时逐字节一致);模板只覆盖 fontSize/letterSpacing/riseDistance
const DEFAULT_STYLE = {fontSize: 46, letterSpacing: '0.1em', riseDistance: 10} as const;

export const ChapterCard: React.FC<{clip: ChapterClip; background: string; palette: Palette; style?: TemplateChapterCardStyle; fontFamily?: FontFamily}> = ({clip, background, palette, style, fontFamily = 'serif'}) => {
  const frame = useCurrentFrame();
  const {fps, width, height} = useVideoConfig();
  const t = frame / fps;
  const fade = Math.min(interpolate(t, [clip.start, clip.start + 0.35], [0, 1], clamp), interpolate(t, [clip.end - 0.35, clip.end], [1, 0], clamp));
  const scale = getVisualScale(width, height);
  const s = {...DEFAULT_STYLE, ...style};
  return <AbsoluteFill style={{backgroundColor: background, opacity: fade, justifyContent: 'center', alignItems: 'center'}}><div style={{fontFamily: FONT_FAMILY[fontFamily].mixed, color: palette.text, fontSize: s.fontSize * scale, letterSpacing: s.letterSpacing, transform: `translateY(${(1 - fade) * s.riseDistance * scale}px)`}}>{clip.text}</div></AbsoluteFill>;
};
