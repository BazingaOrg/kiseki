import React from 'react';
import {AbsoluteFill, interpolate} from 'remotion';
import {FONT_FAMILY, OUTRO, type FontFamily, type Palette} from './theme';

const clamp = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;

export const outroOpacityAt = (whiteFade: number, text: string, credit = '') =>
  !text && !credit ? 0 : interpolate(whiteFade, [...OUTRO.fadeRange], [0, 1], clamp);

/**
 * 片尾谢幕语:白场过半后居中浮现。纯展示组件,时序/opacity 由调用方计算传入。
 * credit 是歌名和作者，另起一行，不放进片尾文字。
 */
export const Outro: React.FC<{
  text: string;
  credit?: string;
  scale: number;
  opacity: number;
  palette: Palette;
  fontFamily?: FontFamily;
}> = ({text, credit = '', scale, opacity, palette, fontFamily = 'sans'}) => {
  if ((!text && !credit) || opacity <= 0) return null;

  return (
    <AbsoluteFill style={{justifyContent: 'center', alignItems: 'center'}}>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: Math.round(12 * scale),
          maxWidth: '78%',
          textAlign: 'center',
          opacity,
          transform: `translateY(${(1 - opacity) * OUTRO.riseDistance * scale}px)`,
        }}
      >
        {text ? (
          <div
            style={{
              fontFamily: FONT_FAMILY[fontFamily].mixed,
              fontSize: OUTRO.fontSize * scale,
              fontWeight: OUTRO.fontWeight,
              letterSpacing: OUTRO.letterSpacing,
              color: palette.text,
            }}
          >
            {text}
          </div>
        ) : null}
        {credit ? (
          <div
            style={{
              fontFamily: FONT_FAMILY[fontFamily].mixed,
              fontSize: OUTRO.creditFontSize * scale,
              fontWeight: 400,
              letterSpacing: OUTRO.letterSpacing,
              lineHeight: 1.35,
              color: palette.text,
              opacity: 0.72,
            }}
          >
            {credit}
          </div>
        ) : null}
      </div>
    </AbsoluteFill>
  );
};
