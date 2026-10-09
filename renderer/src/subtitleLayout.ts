import {fullwidthLength} from './fontFamily.ts';
import type {SubtitleLine} from './types.ts';

const TRANSLATION_FONT_RATIO = 0.8;
const BILINGUAL_GAP = 6;
const MIN_FONT_SCALE = 0.72;

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
  bilingual,
}: {
  line: SubtitleLine;
  nextLine: SubtitleLine | undefined;
  fadeOutDuration: number;
  bilingual: boolean;
}): number => {
  const naturalEnd = line.end + fadeOutDuration;
  return bilingual && nextLine ? Math.min(naturalEnd, nextLine.start) : naturalEnd;
};

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
}: {
  photoScale: number;
  canvasHeight: number;
  fontSize: number;
  scale: number;
  riseDistance?: number;
  exitRise?: number;
}): number => {
  if (!(canvasHeight > 0) || !(photoScale >= 0)) return photoScale;
  const blockHeight = subtitleBlockHeight({fontSize: fontSize * scale, bilingual: true, scale});
  const requiredBand = blockHeight + Math.abs(riseDistance) * scale + Math.abs(exitRise) * scale;
  return Math.max(0, Math.min(photoScale, 1 - (2 * requiredBand) / canvasHeight));
};
