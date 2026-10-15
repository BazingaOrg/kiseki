import {fullwidthLength} from './fontFamily.ts';
import {SUBTITLE_PHOTO_GAP} from './photoCaptionLayout.mjs';
import type {SubtitleLine} from './types.ts';

const TRANSLATION_FONT_RATIO = 0.8;
const BILINGUAL_GAP = 6;
const MIN_FONT_SCALE = 0.72;
export const MAX_SUBTITLE_HOLD = 8;

export const hasTranslation = (line: SubtitleLine): boolean => Boolean(line.translation?.text.trim());

export type SubtitleDisplayMode = 'none' | 'original' | 'bilingual';

export const resolveSubtitleMode = (
  mode: SubtitleDisplayMode | undefined,
  lines: SubtitleLine[],
): SubtitleDisplayMode => {
  if (mode === 'none') return 'none';
  return mode !== 'original' && lines.some(hasTranslation) ? 'bilingual' : 'original';
};

export const resolveBilingualMode = (mode: SubtitleDisplayMode | undefined, lines: SubtitleLine[]): boolean =>
  resolveSubtitleMode(mode, lines) === 'bilingual';

export const subtitleSignatureInsets = ({
  visible,
  portrait,
  scale,
  signatureWidth,
  signatureHeight,
  rightInset,
  bottomInset,
  gap,
}: {
  visible: boolean;
  portrait: boolean;
  scale: number;
  signatureWidth: number;
  signatureHeight: number;
  rightInset: number;
  bottomInset: number;
  gap: number;
}): {sideInset: number; bottomInset: number} => {
  if (!visible) return {sideInset: 0, bottomInset: 0};
  return portrait
    ? {sideInset: 0, bottomInset: (bottomInset + signatureHeight + gap) * scale}
    : {sideInset: rightInset * scale + signatureWidth + gap * scale, bottomInset: 0};
};

export const subtitleVisibilityEnd = ({
  line,
  nextLine,
  fadeOutDuration,
}: {
  line: SubtitleLine;
  nextLine: SubtitleLine | undefined;
  fadeOutDuration: number;
}): number => {
  const naturalEnd = subtitleLineEnd(line) + fadeOutDuration;
  return nextLine ? Math.min(naturalEnd, nextLine.start) : naturalEnd;
};

export const subtitleLineEnd = (line: SubtitleLine): number => Math.min(line.end, line.start + MAX_SUBTITLE_HOLD);

export const subtitleFadeOutStart = (lineStart: number, lineEnd: number, visibilityEnd: number, handoffFadeDuration: number): number =>
  visibilityEnd <= lineEnd ? Math.max(lineStart, visibilityEnd - handoffFadeDuration) : lineEnd;

export const fitSubtitleFontSize = ({
  text,
  fontSize,
  letterSpacing,
  maxWidth,
  measuredWidth,
  enforceMinimum = true,
}: {
  text: string;
  fontSize: number;
  letterSpacing: string;
  maxWidth: number;
  measuredWidth?: number;
  enforceMinimum?: boolean;
}): number => {
  if (!text) return fontSize;
  const estimatedWidth = fontSize * (fullwidthLength(text) + text.length * parseFloat(letterSpacing));
  const width = measuredWidth ?? estimatedWidth;
  if (width <= maxWidth) return fontSize;
  const fittedSize = fontSize * (maxWidth / width);
  if (enforceMinimum && fittedSize < fontSize * MIN_FONT_SCALE) {
    throw new Error(`字幕过长，无法在安全字幕区显示：${text}`);
  }
  return fittedSize;
};

export const translationFontSize = (fontSize: number): number => fontSize * TRANSLATION_FONT_RATIO;

export const subtitleBlockHeight = ({
  fontSize,
  bilingual,
  scale,
}: {
  fontSize: number;
  bilingual: boolean;
  scale: number;
}): number => bilingual ? fontSize * 1.2 + BILINGUAL_GAP * scale + translationFontSize(fontSize) * 1.2 : fontSize;

export const subtitleTranslationGap = (scale: number): number => BILINGUAL_GAP * scale;

export const subtitleBlockBottom = ({
  bandBottomFromBottom,
  bandTopFromBottom,
  blockHeight,
  photoGap,
}: {
  bandBottomFromBottom: number;
  bandTopFromBottom: number;
  blockHeight: number;
  photoGap: number;
}): number => {
  const room = Math.max(0, bandTopFromBottom - bandBottomFromBottom - blockHeight);
  const gap = Math.min(Math.max(0, photoGap), room);
  const centered = (bandBottomFromBottom + bandTopFromBottom) / 2 - blockHeight / 2;
  const cleared = bandTopFromBottom - gap - blockHeight;
  return Math.max(bandBottomFromBottom, Math.min(centered, cleared));
};

export const subtitlePhotoGap = (scale: number): number => SUBTITLE_PHOTO_GAP * scale;

export const assertSubtitleSafeHeight = ({
  blockHeight,
  bandBottomFromBottom,
  bandTopFromBottom,
  riseDown,
  riseUp,
  bilingual,
}: {
  blockHeight: number;
  bandBottomFromBottom: number;
  bandTopFromBottom: number;
  riseDown: number;
  riseUp: number;
  bilingual: boolean;
}): void => {
  if (bilingual && blockHeight + riseDown + riseUp > bandTopFromBottom - bandBottomFromBottom) {
    throw new Error('双语字幕安全区不足，请调整照片安全框或改用原文显示');
  }
};

export const fitDiaryPhotoScale = ({
  photoScale,
  canvasHeight,
  fontSize,
  scale,
  riseDistance = 0,
  exitRise = 0,
  photoGap = SUBTITLE_PHOTO_GAP,
}: {
  photoScale: number;
  canvasHeight: number;
  fontSize: number;
  scale: number;
  riseDistance?: number;
  exitRise?: number;
  photoGap?: number;
}): number => {
  if (!(canvasHeight > 0) || !(photoScale >= 0)) return photoScale;
  const blockHeight = subtitleBlockHeight({fontSize: fontSize * scale, bilingual: true, scale});
  const requiredBand = blockHeight + photoGap * scale + Math.abs(riseDistance) * scale + Math.abs(exitRise) * scale;
  return Math.max(0, Math.min(photoScale, 1 - (2 * requiredBand) / canvasHeight));
};
