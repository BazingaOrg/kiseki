import React from 'react';
import {FONT_FAMILY, type FontFamily} from './theme';

export const DayStamp: React.FC<{text?: string | null; scale: number; fontFamily?: FontFamily}> = ({text, scale, fontFamily = 'sans'}) => {
  if (!text) return null;
  const inset = Math.round(14 * scale);
  return (
    <div
      style={{
        position: 'absolute',
        left: inset,
        bottom: inset,
        maxWidth: '78%',
        color: '#fff',
        fontFamily: FONT_FAMILY[fontFamily].zh,
        fontSize: Math.round(22 * scale),
        fontWeight: 500,
        letterSpacing: '0.04em',
        lineHeight: 1.2,
        textShadow: '0 1px 8px rgba(0, 0, 0, 0.55)',
        pointerEvents: 'none',
      }}
    >
      {text}
    </div>
  );
};
