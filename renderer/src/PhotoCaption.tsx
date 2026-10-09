import React from 'react';
import {CAPTION_BAND_PAD, CAPTION_FONT_WEIGHT, isCaptionLayout, type CaptionLayout} from './photoCaptionLayout.mjs';
import type {Palette} from './theme';

export const PhotoCaption: React.FC<{
  text: string;
  layout: CaptionLayout | null | undefined | unknown;
  palette: Palette;
  fontFamily: string;
  opacity?: number;
  flow?: boolean;
  band?: boolean;
  fontWeight?: number;
}> = ({text, layout, palette, fontFamily, opacity = 1, flow = false, band = false, fontWeight = CAPTION_FONT_WEIGHT}) => {
  const resolved = isCaptionLayout(layout) ? layout : null;
  if (!text || !resolved) return null;
  const fontSize = resolved.fontSize;
  const letterSpacing = resolved.letterSpacing;
  if (band || flow) {
    return (
      <div
        style={{
          position: band ? 'absolute' : 'relative',
          top: band ? 0 : undefined,
          left: band ? 0 : undefined,
          right: band ? 0 : undefined,
          zIndex: band ? 5 : undefined,
          padding: band ? `${CAPTION_BAND_PAD}px ${CAPTION_BAND_PAD}px 0` : undefined,
          width: flow ? resolved.width : undefined,
          maxWidth: flow ? undefined : '86%',
          flexShrink: flow ? 0 : undefined,
          display: 'flex',
          justifyContent: 'center',
          pointerEvents: 'none',
          opacity,
        }}
      >
        <div
          style={{
            color: palette.text,
            fontFamily,
            fontSize,
            fontWeight,
            letterSpacing,
            lineHeight: 1.35,
            textAlign: 'center',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            width: '100%',
          }}
        >
          {text}
        </div>
      </div>
    );
  }
  if (!resolved || !('x' in resolved)) return null;
  return (
    <div
      style={{
        position: 'absolute',
        left: resolved.x,
        top: resolved.y,
        width: resolved.width,
        height: resolved.height,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: palette.text,
        fontFamily,
        fontSize,
        fontWeight,
        letterSpacing,
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
