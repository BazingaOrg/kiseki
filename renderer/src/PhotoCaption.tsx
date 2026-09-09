import React from 'react';
import {CAPTION_FONT_WEIGHT, type CaptionLayout} from './photoCaptionLayout.mjs';
import type {Palette} from './theme';

export const PhotoCaption: React.FC<{
  text: string;
  layout: CaptionLayout | null | undefined | unknown;
  palette: Palette;
  fontFamily: string;
  opacity?: number;
  flow?: boolean;
}> = ({text, layout, palette, fontFamily, opacity = 1, flow = false}) => {
  const resolved = layout && typeof layout === 'object' && 'x' in layout && 'fontSize' in layout
    ? layout as CaptionLayout
    : null;
  if (!resolved || !text) return null;
  return (
    <div
      style={{
        position: flow ? 'relative' : 'absolute',
        left: flow ? undefined : resolved.x,
        top: flow ? undefined : resolved.y,
        width: resolved.width,
        height: resolved.height,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: palette.text,
        fontFamily,
        fontSize: resolved.fontSize,
        fontWeight: CAPTION_FONT_WEIGHT,
        letterSpacing: resolved.letterSpacing,
        lineHeight: 1.35,
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        opacity,
        pointerEvents: 'none',
      }}
    >
      {text}
    </div>
  );
};
