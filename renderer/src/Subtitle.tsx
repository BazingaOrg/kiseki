import React from 'react';
import {Easing, interpolate, useCurrentFrame, useVideoConfig} from 'remotion';
import {SUBTITLE, type FontFamily, type Palette} from './theme';
import {fullwidthLength, resolveFontFamily} from './fontFamily';
import type {SubtitleLine} from './types';
import type {TemplateCaptionsStyle} from './templates';

const clamp = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;
const easeOut = {...clamp, easing: Easing.out(Easing.cubic)} as const;

export const Subtitle: React.FC<{
  line: SubtitleLine;
  scale: number;
  bandCenterFromBottom: number; // 照片安全框下缘到画布底部的带状区域中心,距底 px
  sideInset?: number; // 左右对称预留,避免长字幕与右下角落款交叠
  palette: Palette;
  /** 模板注入的字幕呈现样式;缺省用全局 SUBTITLE 常量(时序/过滤字段永远全局) */
  captions?: TemplateCaptionsStyle;
  /** 模板声明的字族;缺省衬线(展陈题签) */
  fontFamily?: FontFamily;
}> = ({line, scale, bandCenterFromBottom, sideInset = 0, palette, captions, fontFamily = 'serif'}) => {
  const frame = useCurrentFrame();
  const {fps, width} = useVideoConfig();
  const t = frame / fps;

  // 模板只覆盖"长相"(字号/字重/字距/位移),淡入淡出等时序仍走全局常量
  const style = {...SUBTITLE, ...captions};

  const inEnd = line.start + style.fadeInDuration;
  const outEnd = line.end + style.fadeOutDuration;
  const fadeIn = interpolate(t, [line.start, inEnd], [0, 1], clamp);
  const fadeOut = interpolate(t, [line.end, outEnd], [1, 0], clamp);
  const opacity = Math.min(fadeIn, fadeOut);

  // 摄影展题签式动效:只保留克制的淡化与短距离位移。
  const riseIn = interpolate(t, [line.start, inEnd], [style.riseDistance * scale, 0], easeOut);
  const riseOut = interpolate(t, [line.end, outEnd], [0, -style.exitRise * scale], easeOut);
  const rise = riseIn + riseOut;

  const letterSpacing =
    fullwidthLength(line.text) > style.compactThreshold
      ? style.letterSpacingCompact
      : style.letterSpacing;

  // 超宽兜底:analyze 层已按词拆行,但手改 timeline 等场景仍可能出现超长行,
  // 按估算宽度等比缩小字号,保证不溢出画布(估算:全角 1em、半角 0.5em + 字距)
  const spacingEm = parseFloat(letterSpacing);
  const units = fullwidthLength(line.text);
  const baseSize = style.fontSize * scale;
  const estWidth = baseSize * (units + line.text.length * spacingEm);
  const maxWidth = Math.min(width * 0.86, Math.max(1, width - sideInset * 2));
  const fontSize = estWidth > maxWidth ? baseSize * (maxWidth / estWidth) : baseSize;

  // 行框(lineHeight 1)垂直居中于照片下缘与画布底部之间的带状区域
  const bottom = bandCenterFromBottom - fontSize / 2;

  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom,
        textAlign: 'center',
        opacity,
        transform: `translateY(${rise}px)`,
      }}
    >
      <span
        style={{
          fontFamily: resolveFontFamily(line.text, line.lang, fontFamily),
          fontSize,
          fontWeight: style.fontWeight,
          color: palette.text,
          lineHeight: 1,
          letterSpacing,
          // letter-spacing 会在末字符后多出一份间距,负 margin 抵消以保持视觉居中
          marginRight: `-${letterSpacing}`,
          whiteSpace: 'nowrap',
        }}
      >
        {line.text}
      </span>
    </div>
  );
};
