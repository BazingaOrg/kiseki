import React from 'react';
import {Easing, interpolate, useCurrentFrame, useVideoConfig} from 'remotion';
import {FONT_FAMILY, SUBTITLE, type Palette} from './theme';
import type {SubtitleLine} from './types';
import type {TemplateCaptionsStyle} from './templates';

const clamp = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;
const easeOut = {...clamp, easing: Easing.out(Easing.cubic)} as const;

const KANA_RE = /[぀-ヿ]/; // ひらがな + カタカナ
const CJK_RE = /[㐀-䶿一-鿿豈-﫿]/;
const LATIN_ONLY_RE = /^[ -ɏ -⁯]*$/;
const FULLWIDTH_RE = /[　-〿＀-￯]/;

/**
 * 逐行字体路由(实现方案第二节):
 * 含假名 → JP;纯 CJK 无假名 → SC(Whisper 标 ja 时用 JP 双重校验);
 * 纯拉丁 → Noto Serif;混合行走 font stack 自然回退。
 */
export const resolveFontFamily = (text: string, lang: SubtitleLine['lang']): string => {
  if (KANA_RE.test(text)) return FONT_FAMILY.ja;
  if (CJK_RE.test(text)) return lang === 'ja' ? FONT_FAMILY.ja : FONT_FAMILY.zh;
  if (LATIN_ONLY_RE.test(text)) return FONT_FAMILY.en;
  return FONT_FAMILY[lang] ?? FONT_FAMILY.mixed;
};

/** 全角等效字符数:CJK/假名/全角符号计 1,其余计 0.5 */
export const fullwidthLength = (text: string): number => {
  let n = 0;
  for (const ch of text) {
    n += KANA_RE.test(ch) || CJK_RE.test(ch) || FULLWIDTH_RE.test(ch) ? 1 : 0.5;
  }
  return n;
};

export const Subtitle: React.FC<{
  line: SubtitleLine;
  scale: number;
  bandCenterFromBottom: number; // 照片安全框下缘到画布底部的带状区域中心,距底 px
  sideInset?: number; // 左右对称预留,避免长字幕与右下角落款交叠
  palette: Palette;
  /** 模板注入的字幕呈现样式;缺省用全局 SUBTITLE 常量(时序/过滤字段永远全局) */
  captions?: TemplateCaptionsStyle;
}> = ({line, scale, bandCenterFromBottom, sideInset = 0, palette, captions}) => {
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
          fontFamily: resolveFontFamily(line.text, line.lang),
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
