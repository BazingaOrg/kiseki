import React from 'react';
import {AbsoluteFill} from 'remotion';
import {FONT_FAMILY, OUTRO, type FontFamily, type Palette} from './theme';

/**
 * 片尾谢幕语:白场过半后居中浮现。纯展示组件,时序/opacity 由调用方计算传入。
 */
export const Outro: React.FC<{
  text: string;
  scale: number;
  opacity: number;
  palette: Palette;
  fontFamily?: FontFamily;
}> = ({text, scale, opacity, palette, fontFamily = 'serif'}) => {
  if (!text || opacity <= 0) return null;

  return (
    <AbsoluteFill style={{justifyContent: 'center', alignItems: 'center'}}>
      <div
        style={{
          fontFamily: FONT_FAMILY[fontFamily].mixed,
          fontSize: OUTRO.fontSize * scale,
          fontWeight: OUTRO.fontWeight,
          letterSpacing: OUTRO.letterSpacing,
          color: palette.text,
          opacity,
          transform: `translateY(${(1 - opacity) * OUTRO.riseDistance * scale}px)`,
        }}
      >
        {text}
      </div>
    </AbsoluteFill>
  );
};
