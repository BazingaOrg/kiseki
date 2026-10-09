export const CAPTION_FONT_SIZE = 32;
export const CAPTION_MIN_FONT_SIZE = 24;
export const CAPTION_FONT_WEIGHT = 300;
export const CAPTION_LETTER_SPACING = 0.16;
export const CAPTION_COMPACT_LETTER_SPACING = 0.1;
export const CAPTION_COMPACT_THRESHOLD = 18;
export const CAPTION_MAX_WIDTH_RATIO = 0.86;
export const CAPTION_LINE_HEIGHT = 1.35;
export const CAPTION_BAND_PAD = 40;
export const CAPTION_SUBJECT_GAP = 56;
const LAYOUT_EPSILON = 1e-6;
export const CAPTION_EDGE_PAD = CAPTION_BAND_PAD;
export const STILL_CAPTION_RESERVE = 96;
export const STILL_CAPTION_GAP = CAPTION_SUBJECT_GAP;
export const STILL_CAPTION_SIGN_GAP = CAPTION_SUBJECT_GAP;
export const STILL_SIGNATURE_HEIGHT = 72;
export const STILL_SIGNATURE_BOTTOM_INSET = 26;
export const FILMSTRIP_MAIN_PHOTO_FACTOR = 0.92;
export const FILMSTRIP_MAIN_PHOTO_FACTOR_CAPTION = 0.86;
export const POLAROID_PHOTO_FACTOR = 0.9;
export const POLAROID_PHOTO_FACTOR_CAPTION = 0.84;

export const isCaptionLayout = (layout) => Boolean(
  layout &&
  typeof layout === 'object' &&
  Number.isFinite(layout.x) &&
  Number.isFinite(layout.y) &&
  Number.isFinite(layout.width) && layout.width > 0 &&
  Number.isFinite(layout.height) && layout.height > 0 &&
  Number.isFinite(layout.fontSize) && layout.fontSize > 0 &&
  typeof layout.letterSpacing === 'string',
);

export const letterSpacingFor = (codePoints) =>
  codePoints > CAPTION_COMPACT_THRESHOLD ? CAPTION_COMPACT_LETTER_SPACING : CAPTION_LETTER_SPACING;

export const containSize = (imageWidth, imageHeight, maxWidth, maxHeight) => {
  if (!(imageWidth > 0) || !(imageHeight > 0) || !(maxWidth > 0) || !(maxHeight > 0)) {
    return {width: 0, height: 0};
  }
  const ratio = Math.min(maxWidth / imageWidth, maxHeight / imageHeight);
  return {width: imageWidth * ratio, height: imageHeight * ratio};
};

export const chooseFontSize = ({measuredAtMax, maxWidth, visualScale}) => {
  const maxSize = CAPTION_FONT_SIZE * visualScale;
  const minSize = CAPTION_MIN_FONT_SIZE * visualScale;
  if (!(measuredAtMax > 0) || !(maxWidth > 0)) return null;
  if (measuredAtMax <= maxWidth) return maxSize;
  const next = maxSize * (maxWidth / measuredAtMax);
  if (next < minSize) return null;
  return next;
};

const captionLineMetrics = ({measuredAtMax, maxTextWidth, visualScale, codePoints, tracking}) => {
  const letterSpacing = tracking ?? letterSpacingFor(codePoints);
  const fontSize = chooseFontSize({measuredAtMax, maxWidth: maxTextWidth, visualScale});
  if (fontSize == null) return null;
  return {
    fontSize,
    lineHeight: CAPTION_LINE_HEIGHT * fontSize,
    letterSpacing: `${letterSpacing}em`,
  };
};

export const layoutTopBandCaption = ({
  canvasWidth,
  canvasHeight,
  visualScale,
  subjectTop,
  maxTextWidth,
  measuredAtMax,
  codePoints,
  tracking,
}) => {
  const pad = CAPTION_BAND_PAD * visualScale;
  const gap = CAPTION_SUBJECT_GAP * visualScale;
  const metrics = captionLineMetrics({measuredAtMax, maxTextWidth, visualScale, codePoints, tracking});
  if (!metrics) return null;
  const y = subjectTop - gap - metrics.lineHeight;
  if (y + LAYOUT_EPSILON < pad || subjectTop - gap + LAYOUT_EPSILON < metrics.lineHeight || subjectTop <= pad + gap) return null;
  return {
    x: (canvasWidth - maxTextWidth) / 2,
    y,
    width: maxTextWidth,
    height: metrics.lineHeight,
    fontSize: metrics.fontSize,
    letterSpacing: metrics.letterSpacing,
  };
};

export const layoutSafeCaption = ({
  canvasWidth,
  canvasHeight,
  visualScale,
  maxTextWidth,
  measuredAtMax,
  codePoints,
  tracking,
  photoTop = null,
  photoBottom = null,
}) => {
  const metrics = captionLineMetrics({measuredAtMax, maxTextWidth, visualScale, codePoints, tracking});
  if (!metrics) return null;
  if (photoTop != null) {
    const above = layoutTopBandCaption({
      canvasWidth,
      canvasHeight,
      visualScale,
      subjectTop: photoTop,
      maxTextWidth,
      measuredAtMax,
      codePoints,
      tracking,
    });
    if (above) return above;
  }
  if (photoBottom != null) {
    const below = layoutBelowSubjectCaption({
      canvasWidth,
      canvasHeight,
      visualScale,
      subjectBottom: photoBottom,
      maxTextWidth,
      measuredAtMax,
      codePoints,
      tracking,
    });
    if (below) return below;
  }
  return null;
};

export const layoutBelowSubjectCaption = ({
  canvasWidth,
  canvasHeight,
  visualScale,
  subjectBottom,
  maxTextWidth,
  measuredAtMax,
  codePoints,
  tracking,
  floor = null,
}) => {
  const pad = CAPTION_BAND_PAD * visualScale;
  const gap = CAPTION_SUBJECT_GAP * visualScale;
  const metrics = captionLineMetrics({measuredAtMax, maxTextWidth, visualScale, codePoints, tracking});
  if (!metrics) return null;
  const y = subjectBottom + gap;
  const bottom = y + metrics.lineHeight;
  const limit = floor ?? (canvasHeight - pad);
  if (y + LAYOUT_EPSILON < pad || bottom > limit + LAYOUT_EPSILON) return null;
  return {
    x: (canvasWidth - maxTextWidth) / 2,
    y,
    width: maxTextWidth,
    height: metrics.lineHeight,
    fontSize: metrics.fontSize,
    letterSpacing: metrics.letterSpacing,
  };
};

export const resolveVideoPhotoScale = ({
  photoScale,
  canvasHeight,
  visualScale,
  bilingual = false,
  hasCaption = false,
  fontSize = 30,
  riseDistance = 0,
  exitRise = 0,
  subtitleBottomInset = 0,
}) => {
  let scale = photoScale;
  if ((bilingual || subtitleBottomInset > 0) && canvasHeight > 0) {
    const blockHeight = bilingual
      ? fontSize * visualScale * 1.2 + 6 * visualScale + fontSize * visualScale * 0.8 * 1.2
      : fontSize * visualScale;
    const requiredBand = subtitleBottomInset + blockHeight + Math.abs(riseDistance) * visualScale + Math.abs(exitRise) * visualScale;
    scale = Math.max(0, Math.min(scale, 1 - (2 * requiredBand) / canvasHeight));
  }
  if (hasCaption && canvasHeight > 0) {
    const needed = (CAPTION_BAND_PAD + CAPTION_FONT_SIZE * CAPTION_LINE_HEIGHT + CAPTION_SUBJECT_GAP) * visualScale;
    scale = Math.min(scale, Math.max(0, 1 - (2 * needed) / canvasHeight));
  }
  return scale;
};

export const signaturePhotoLift = ({
  canvasHeight,
  maxPhotoHeight,
  visualScale,
  sign = false,
  hasExif = false,
}) => {
  if (!sign || hasExif || !(maxPhotoHeight > 0) || !(canvasHeight > 0)) return 0;
  const signTop = canvasHeight - (STILL_SIGNATURE_BOTTOM_INSET + STILL_SIGNATURE_HEIGHT) * visualScale;
  const gap = CAPTION_SUBJECT_GAP * visualScale;
  const centeredTop = (canvasHeight - maxPhotoHeight) / 2;
  const overflow = centeredTop + maxPhotoHeight + gap - signTop;
  if (overflow <= 0) return 0;
  return Math.min(overflow, Math.max(0, centeredTop));
};

export const layoutStillCaption = ({
  canvasWidth,
  canvasHeight,
  visualScale,
  photoBox,
  maxTextWidth,
  measuredAtMax,
  codePoints,
  signTop = null,
}) => {
  const letterSpacing = letterSpacingFor(codePoints);
  const fontSize = chooseFontSize({measuredAtMax, maxWidth: maxTextWidth, visualScale});
  if (fontSize == null) return null;
  const lineHeight = CAPTION_LINE_HEIGHT * fontSize;
  const gap = CAPTION_SUBJECT_GAP * visualScale;
  const y = photoBox.y + photoBox.height + gap;
  const layout = {
    x: photoBox.x + (photoBox.width - maxTextWidth) / 2,
    y,
    width: maxTextWidth,
    height: lineHeight,
    fontSize,
    letterSpacing: `${letterSpacing}em`,
  };
  if (signTop != null && signTop - (y + lineHeight) < STILL_CAPTION_SIGN_GAP * visualScale) {
    return null;
  }
  if (y + lineHeight > canvasHeight - CAPTION_BAND_PAD * visualScale) return null;
  return layout;
};

export const rotatedBounds = (width, height, degrees) => {
  const rad = (degrees * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  return {width: width * cos + height * sin, height: width * sin + height * cos};
};

export const captionMaxTextWidth = (regionWidth, visualScale) =>
  Math.max(0, regionWidth * CAPTION_MAX_WIDTH_RATIO);

export const exifLayout = (width, height) => {
  const stacked = height > width;
  return stacked
    ? {stacked, photoMaxWidth: width * 0.84, photoMaxHeight: height * 0.56, panelWidth: width * 0.84, gap: Math.min(width, height) * 0.06}
    : {stacked, photoMaxWidth: width * 0.52, photoMaxHeight: height * 0.72, panelWidth: width * 0.24, gap: width * 0.05};
};

const djb2 = (input) => {
  let hash = 5381;
  for (let i = 0; i < input.length; i += 1) hash = ((hash << 5) + hash + input.charCodeAt(i)) >>> 0;
  return hash;
};

export const polaroidMaxRotation = (src) => Math.abs((djb2(src) % 9) - 4) + 10;

export const videoSubjectBox = ({
  canvasWidth,
  canvasHeight,
  photoScale,
  imageWidth,
  imageHeight,
  hasExif = false,
  sign = false,
  templateId = null,
  src = '',
  motionZoom = 1,
}) => {
  const visualScale = Math.min(canvasWidth, canvasHeight) / 1080;
  if (templateId === 'polaroid') {
    const photo = containSize(
      imageWidth,
      imageHeight,
      canvasWidth * photoScale * POLAROID_PHOTO_FACTOR_CAPTION,
      canvasHeight * photoScale * POLAROID_PHOTO_FACTOR_CAPTION,
    );
    const pad = Math.round(canvasWidth * photoScale * 0.03);
    const card = rotatedBounds(photo.width + pad * 2, photo.height + pad * 2, polaroidMaxRotation(src));
    const top = (canvasHeight - card.height) / 2;
    return {top, height: card.height, bottom: top + card.height};
  }
  const factor = templateId === 'filmstrip' ? FILMSTRIP_MAIN_PHOTO_FACTOR_CAPTION : 1;
  if (hasExif && templateId !== 'filmstrip') {
    const layout = exifLayout(canvasWidth, canvasHeight);
    const photo = containSize(imageWidth, imageHeight, layout.photoMaxWidth, layout.photoMaxHeight);
    const panelEstimate = layout.stacked ? canvasHeight * 0.22 : photo.height;
    const groupHeight = layout.stacked
      ? photo.height + layout.gap + panelEstimate
      : Math.max(photo.height, panelEstimate);
    const groupTop = (canvasHeight - groupHeight) / 2;
    return {top: groupTop, height: photo.height, bottom: groupTop + photo.height};
  }
  const maxPhotoHeight = canvasHeight * photoScale * factor;
  const photo = containSize(
    imageWidth,
    imageHeight,
    canvasWidth * photoScale * factor,
    maxPhotoHeight,
  );
  let top = (canvasHeight - photo.height) / 2;
  if (motionZoom > 1) top -= (motionZoom - 1) * maxPhotoHeight / 2;
  if (templateId !== 'filmstrip') {
    top -= signaturePhotoLift({
      canvasHeight,
      maxPhotoHeight,
      visualScale,
      sign,
      hasExif,
    });
  }
  return {top, height: photo.height, bottom: top + photo.height};
};

export const videoSubjectTop = (args) => videoSubjectBox(args).top;

export const stillCaptionMetrics = ({
  canvasWidth,
  canvasHeight,
  visualScale,
  photoScale,
  imageWidth,
  imageHeight,
  hasExif,
  sign,
  hasCaption = false,
}) => {
  const layout = hasExif ? exifLayout(canvasWidth, canvasHeight) : null;
  const gap = CAPTION_SUBJECT_GAP * visualScale;
  const pad = CAPTION_BAND_PAD * visualScale;
  const stacked = Boolean(layout?.stacked);
  const captionBlock = hasCaption ? CAPTION_FONT_SIZE * CAPTION_LINE_HEIGHT * visualScale + gap : 0;
  const signBlock = sign && !hasExif
    ? (STILL_SIGNATURE_BOTTOM_INSET + STILL_SIGNATURE_HEIGHT) * visualScale + gap
    : pad;
  const panelEstimate = stacked ? canvasHeight * 0.22 : 0;
  const exifBlock = stacked && layout ? layout.gap + panelEstimate : 0;
  let maxW = hasExif ? layout.photoMaxWidth : canvasWidth * photoScale;
  let maxH = hasExif ? layout.photoMaxHeight : canvasHeight * photoScale;
  maxW = Math.min(maxW, Math.max(1, canvasWidth - pad * 2));
  maxH = Math.min(maxH, Math.max(1, canvasHeight - pad - captionBlock - signBlock - exifBlock));
  const photo = containSize(imageWidth, imageHeight, maxW, Math.max(1, maxH));
  const groupHeight = captionBlock + photo.height + exifBlock;
  const groupTop = Math.max(pad, Math.min((canvasHeight - groupHeight) / 2, canvasHeight - signBlock - groupHeight));
  const lift = hasCaption ? 0 : signaturePhotoLift({
    canvasHeight,
    maxPhotoHeight: hasExif ? 0 : canvasHeight * photoScale,
    visualScale,
    sign,
    hasExif,
  });
  const photoBox = {
    x: hasExif && !stacked
      ? (canvasWidth - (photo.width + layout.gap + layout.panelWidth)) / 2
      : (canvasWidth - photo.width) / 2,
    y: groupTop + captionBlock - lift,
    width: photo.width,
    height: photo.height,
  };
  const signTop = sign && !hasExif
    ? canvasHeight - (STILL_SIGNATURE_BOTTOM_INSET + STILL_SIGNATURE_HEIGHT) * visualScale
    : null;
  return {photoBox, photoMaxWidth: maxW, photoMaxHeight: maxH, signTop, lift, gap, stacked};
};
