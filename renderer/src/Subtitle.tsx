import React from 'react';
import {cancelRender, delayRender, Easing, interpolate, continueRender, useCurrentFrame, useVideoConfig} from 'remotion';
import {ensureFonts} from './fonts';
import {SUBTITLE, type FontFamily, type Palette} from './theme';
import {fullwidthLength, resolveFontFamily} from './fontFamily';
import type {SubtitleLine} from './types';
import type {TemplateCaptionsStyle} from './templates';
import {assertSubtitleSafeHeight, fitSubtitleFontSize, subtitleBlockBottom, subtitleBlockHeight, subtitleFadeOutStart, subtitlePhotoGap, subtitleTranslationGap, translationFontSize} from './subtitleLayout';

const clamp = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;
const easeOut = {...clamp, easing: Easing.out(Easing.cubic)} as const;
const MUSICAL_NOTE = '♪';

const measureTextWidth = ({text, fontFamily, fontSize, fontWeight, letterSpacing}: {
  text: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  letterSpacing: string;
}): number | undefined => {
  if (typeof document === 'undefined') return undefined;
  const context = document.createElement('canvas').getContext('2d');
  if (!context) return undefined;
  context.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
  return context.measureText(text).width + Math.max(0, [...text].length - 1) * fontSize * parseFloat(letterSpacing);
};

export const Subtitle: React.FC<{
  line: SubtitleLine;
  scale: number;
  bandCenterFromBottom: number; // 照片安全框下缘到画布底部的带状区域中心,距底 px
  bandBottomFromBottom?: number;
  bandTopFromBottom?: number;
  sideInset?: number; // 左右对称预留,避免长字幕与右下角落款交叠
  palette: Palette;
  /** 模板注入的字幕呈现样式;缺省用全局 SUBTITLE 常量(时序/过滤字段永远全局) */
  captions?: TemplateCaptionsStyle;
  /** 模板声明的字族;缺省衬线(展陈题签) */
  fontFamily?: FontFamily;
  bilingual?: boolean;
  visibilityEnd?: number;
}> = ({line, scale, bandCenterFromBottom, bandBottomFromBottom = 0, bandTopFromBottom = bandCenterFromBottom * 2, sideInset = 0, palette, captions, fontFamily = 'sans', bilingual = false, visibilityEnd}) => {
  const frame = useCurrentFrame();
  const {fps, width} = useVideoConfig();
  const t = frame / fps;
  const [fontsReady, setFontsReady] = React.useState(() => typeof document === 'undefined');
  const [fontHandle] = React.useState(() => typeof document === 'undefined' ? null : delayRender('measuring subtitle fonts'));
  const fontHandleFinished = React.useRef(false);
  const finishFontHandle = React.useCallback(() => {
    if (fontHandle !== null && !fontHandleFinished.current) {
      fontHandleFinished.current = true;
      continueRender(fontHandle);
    }
  }, [fontHandle]);

  React.useEffect(() => {
    let active = true;
    if (fontHandle === null) return undefined;
    void ensureFonts(fontFamily)
      .then(() => {
        if (active) setFontsReady(true);
        else finishFontHandle();
      })
      .catch((error: unknown) => cancelRender(error));
    return () => {
      active = false;
      finishFontHandle();
    };
  }, [finishFontHandle, fontFamily, fontHandle]);

  React.useLayoutEffect(() => {
    if (fontsReady) finishFontHandle();
  }, [finishFontHandle, fontsReady]);

  // 模板只覆盖"长相"(字号/字重/字距/位移),淡入淡出等时序仍走全局常量
  const style = {...SUBTITLE, ...captions};

  const inStart = line.start - style.fadeInDuration;
  const inEnd = line.start;
  const outEnd = Math.min(line.end + style.fadeOutDuration, visibilityEnd ?? Infinity);
  const outStart = subtitleFadeOutStart(line.end, outEnd, style.fadeOutDuration);
  const fadeIn = interpolate(t, [inStart, inEnd], [0, 1], clamp);
  const fadeOut = interpolate(t, [outStart, outEnd], [1, 0], clamp);
  const opacity = Math.min(fadeIn, fadeOut);

  // 摄影展题签式动效:只保留克制的淡化与短距离位移。
  const letterSpacing =
    fullwidthLength(line.text) > style.compactThreshold
      ? style.letterSpacingCompact
      : style.letterSpacing;
  const subtitleText = bilingual ? line.text : `${MUSICAL_NOTE} ${line.text} ${MUSICAL_NOTE}`;
  const baseSize = style.fontSize * scale;
  const maxWidth = Math.min(width * 0.86, Math.max(1, width - sideInset * 2));
  const originalFontFamily = resolveFontFamily(line.text, line.lang, fontFamily);
  const measuredOriginalWidth = React.useMemo(
    () => bilingual && fontsReady ? measureTextWidth({text: subtitleText, fontFamily: originalFontFamily, fontSize: baseSize, fontWeight: style.fontWeight, letterSpacing}) : undefined,
    [bilingual, fontsReady, subtitleText, originalFontFamily, baseSize, style.fontWeight, letterSpacing],
  );
  const originalFontSize = fitSubtitleFontSize({
    text: subtitleText,
    fontSize: baseSize,
    letterSpacing,
    maxWidth,
    measuredWidth: measuredOriginalWidth,
    enforceMinimum: bilingual && fontsReady,
  });
  const translationText = line.translation?.text.trim() ?? '';
  const baseTranslationFontSize = translationFontSize(baseSize);
  const translationFamily = resolveFontFamily(translationText, 'zh', fontFamily);
  const measuredTranslationWidth = React.useMemo(
    () => bilingual && fontsReady ? measureTextWidth({text: translationText, fontFamily: translationFamily, fontSize: baseTranslationFontSize, fontWeight: style.fontWeight, letterSpacing}) : undefined,
    [bilingual, fontsReady, translationText, translationFamily, baseTranslationFontSize, style.fontWeight, letterSpacing],
  );
  const translatedFontSize = bilingual
    ? fitSubtitleFontSize({
      text: translationText,
      fontSize: baseTranslationFontSize,
      letterSpacing,
      maxWidth,
      measuredWidth: measuredTranslationWidth,
      enforceMinimum: fontsReady,
    })
    : 0;
  const blockHeight = subtitleBlockHeight({fontSize: bilingual ? baseSize : originalFontSize, bilingual, scale});
  const bottom = subtitleBlockBottom({
    bandBottomFromBottom,
    bandTopFromBottom,
    blockHeight,
    photoGap: subtitlePhotoGap(scale),
  });
  const motionPad = 6 * scale;
  const riseDown = Math.min(Math.abs(style.riseDistance * scale), Math.max(0, bottom - bandBottomFromBottom - motionPad));
  const riseUp = Math.min(Math.abs(style.exitRise * scale), Math.max(0, bandTopFromBottom - bottom - blockHeight - motionPad));
  const riseIn = interpolate(t, [inStart, inEnd], [riseDown, 0], easeOut);
  const riseOut = interpolate(t, [outStart, outEnd], [0, -riseUp], easeOut);
  const rise = riseIn + riseOut;
  assertSubtitleSafeHeight({blockHeight, bandBottomFromBottom, bandTopFromBottom, riseDown, riseUp, bilingual});

  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom,
        textAlign: 'center',
        opacity: opacity * (captions ? 1 : 0.76),
        transform: `translateY(${rise}px)`,
      }}
    >
      <div
        style={{
          fontFamily: originalFontFamily,
          fontSize: originalFontSize,
          fontWeight: style.fontWeight,
          color: palette.text,
          height: bilingual ? baseSize * 1.2 : undefined,
          display: bilingual ? 'flex' : undefined,
          alignItems: bilingual ? 'center' : undefined,
          justifyContent: bilingual ? 'center' : undefined,
          lineHeight: 1,
          letterSpacing,
          marginRight: `-${letterSpacing}`,
          whiteSpace: 'nowrap',
        }}
      >
        {subtitleText}
      </div>
      {bilingual ? (
        <div
          style={{
            height: baseTranslationFontSize * 1.2,
            marginTop: subtitleTranslationGap(scale),
            fontFamily: translationFamily,
            fontSize: translatedFontSize,
            fontWeight: style.fontWeight,
            color: palette.text,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            lineHeight: 1,
            letterSpacing,
            marginRight: `-${letterSpacing}`,
            whiteSpace: 'nowrap',
          }}
        >
          {translationText}
        </div>
      ) : null}
    </div>
  );
};
