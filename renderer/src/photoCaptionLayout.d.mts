export const CAPTION_FONT_SIZE: number;
export const CAPTION_MIN_FONT_SIZE: number;
export const CAPTION_FONT_WEIGHT: number;
export const CAPTION_LETTER_SPACING: number;
export const CAPTION_COMPACT_LETTER_SPACING: number;
export const CAPTION_COMPACT_THRESHOLD: number;
export const CAPTION_MAX_WIDTH_RATIO: number;
export const CAPTION_LINE_HEIGHT: number;
export const CAPTION_EDGE_PAD: number;
export const STILL_CAPTION_RESERVE: number;
export const STILL_CAPTION_GAP: number;
export const STILL_CAPTION_SIGN_GAP: number;
export const STILL_SIGNATURE_HEIGHT: number;
export const STILL_SIGNATURE_BOTTOM_INSET: number;
export const FILMSTRIP_MAIN_PHOTO_FACTOR: number;
export const FILMSTRIP_MAIN_PHOTO_FACTOR_CAPTION: number;
export const POLAROID_PHOTO_FACTOR: number;
export const POLAROID_PHOTO_FACTOR_CAPTION: number;

export type CaptionLayout = {
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  letterSpacing: string;
};

export function letterSpacingFor(codePoints: number): number;
export function containSize(
  imageWidth: number,
  imageHeight: number,
  maxWidth: number,
  maxHeight: number,
): {width: number; height: number};
export function chooseFontSize(args: {
  measuredAtMax: number;
  maxWidth: number;
  visualScale: number;
}): number | null;
export function layoutTopBandCaption(args: {
  canvasWidth: number;
  canvasHeight: number;
  visualScale: number;
  subjectTop: number;
  maxTextWidth: number;
  measuredAtMax: number;
  codePoints: number;
  tracking?: number;
}): CaptionLayout | null;
export function layoutStillCaption(args: {
  canvasWidth: number;
  canvasHeight: number;
  visualScale: number;
  photoBox: {x: number; y: number; width: number; height: number};
  maxTextWidth: number;
  measuredAtMax: number;
  codePoints: number;
  signTop?: number | null;
}): CaptionLayout | null;
export function rotatedBounds(width: number, height: number, degrees: number): {width: number; height: number};
export function captionMaxTextWidth(regionWidth: number, visualScale: number): number;
export function exifLayout(width: number, height: number): {
  stacked: boolean;
  photoMaxWidth: number;
  photoMaxHeight: number;
  panelWidth: number;
  gap: number;
};
export function polaroidMaxRotation(src: string): number;
export function signaturePhotoLift(args: {
  canvasHeight: number;
  maxPhotoHeight: number;
  visualScale: number;
  sign?: boolean;
  hasExif?: boolean;
}): number;
export function videoSubjectTop(args: {
  canvasWidth: number;
  canvasHeight: number;
  photoScale: number;
  imageWidth: number;
  imageHeight: number;
  hasExif?: boolean;
  sign?: boolean;
  templateId?: string | null;
  src?: string;
  motionZoom?: number;
}): number;
export function stillCaptionMetrics(args: {
  canvasWidth: number;
  canvasHeight: number;
  visualScale: number;
  photoScale: number;
  imageWidth: number;
  imageHeight: number;
  hasExif: boolean;
  sign: boolean;
}): {
  photoBox: {x: number; y: number; width: number; height: number};
  photoMaxWidth: number;
  photoMaxHeight: number;
  signTop: number | null;
  lift: number;
  gap: number;
  stacked: boolean;
};
