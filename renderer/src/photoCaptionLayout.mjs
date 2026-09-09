export const CAPTION_FONT_SIZE = 32;
export const CAPTION_MIN_FONT_SIZE = 24;
export const CAPTION_FONT_WEIGHT = 400;
export const CAPTION_LETTER_SPACING = 0.08;
export const CAPTION_COMPACT_LETTER_SPACING = 0.04;
export const CAPTION_COMPACT_THRESHOLD = 18;
export const CAPTION_MAX_WIDTH_RATIO = 0.86;
export const CAPTION_LINE_HEIGHT = 1.35;
export const CAPTION_EDGE_PAD = 24;
export const STILL_CAPTION_RESERVE = 72;
export const STILL_CAPTION_GAP = 24;
export const STILL_CAPTION_SIGN_LIFT = 16;
export const STILL_CAPTION_SIGN_GAP = 24;
export const STILL_SIGNATURE_HEIGHT = 56;
export const STILL_SIGNATURE_BOTTOM_INSET = 26;
export const FILMSTRIP_MAIN_PHOTO_FACTOR = 0.92;
export const FILMSTRIP_MAIN_PHOTO_FACTOR_CAPTION = 0.86;
export const POLAROID_PHOTO_FACTOR = 0.9;
export const POLAROID_PHOTO_FACTOR_CAPTION = 0.84;

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

export const layoutTopBandCaption = ({
  canvasWidth,
  canvasHeight,
  visualScale,
  subjectTop,
  maxTextWidth,
  measuredAtMax,
  codePoints,
}) => {
  const pad = CAPTION_EDGE_PAD * visualScale;
  const bandTop = pad;
  const bandBottom = subjectTop - pad;
  const bandHeight = bandBottom - bandTop;
  const letterSpacing = letterSpacingFor(codePoints);
  const fontSize = chooseFontSize({measuredAtMax, maxWidth: maxTextWidth, visualScale});
  if (fontSize == null) return null;
  const lineHeight = CAPTION_LINE_HEIGHT * fontSize;
  if (bandHeight < lineHeight || bandHeight <= 0 || subjectTop <= pad * 2) return null;
  return {
    x: (canvasWidth - maxTextWidth) / 2,
    y: bandTop + (bandHeight - lineHeight) / 2,
    width: maxTextWidth,
    height: lineHeight,
    fontSize,
    letterSpacing: `${letterSpacing}em`,
  };
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
  const gap = STILL_CAPTION_GAP * visualScale;
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
  if (y + lineHeight > canvasHeight - CAPTION_EDGE_PAD * visualScale) return null;
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

export const videoSubjectTop = ({
  canvasWidth,
  canvasHeight,
  photoScale,
  imageWidth,
  imageHeight,
  hasExif = false,
  templateId = null,
  src = '',
  motionZoom = 1,
}) => {
  if (templateId === 'polaroid') {
    const photo = containSize(
      imageWidth,
      imageHeight,
      canvasWidth * photoScale * POLAROID_PHOTO_FACTOR_CAPTION,
      canvasHeight * photoScale * POLAROID_PHOTO_FACTOR_CAPTION,
    );
    const pad = Math.round(canvasWidth * photoScale * 0.03);
    const card = rotatedBounds(photo.width + pad * 2, photo.height + pad * 2, polaroidMaxRotation(src));
    return (canvasHeight - card.height) / 2;
  }
  const factor = templateId === 'filmstrip' ? FILMSTRIP_MAIN_PHOTO_FACTOR_CAPTION : 1;
  if (hasExif && templateId !== 'filmstrip') {
    const layout = exifLayout(canvasWidth, canvasHeight);
    const photo = containSize(imageWidth, imageHeight, layout.photoMaxWidth, layout.photoMaxHeight);
    const panelEstimate = layout.stacked ? canvasHeight * 0.22 : photo.height;
    const groupHeight = layout.stacked
      ? photo.height + layout.gap + panelEstimate
      : Math.max(photo.height, panelEstimate);
    return (canvasHeight - groupHeight) / 2;
  }
  const photo = containSize(
    imageWidth,
    imageHeight,
    canvasWidth * photoScale * factor,
    canvasHeight * photoScale * factor,
  );
  let top = (canvasHeight - photo.height) / 2;
  if (motionZoom > 1) top -= (motionZoom - 1) * (canvasHeight * photoScale * factor) / 2;
  return top;
};

export const stillCaptionMetrics = ({
  canvasWidth,
  canvasHeight,
  visualScale,
  photoScale,
  imageWidth,
  imageHeight,
  hasExif,
  sign,
}) => {
  const layout = hasExif ? exifLayout(canvasWidth, canvasHeight) : null;
  const reserve = STILL_CAPTION_RESERVE * visualScale;
  const gap = STILL_CAPTION_GAP * visualScale;
  const maxW = hasExif ? layout.photoMaxWidth : canvasWidth * photoScale;
  const maxH = (hasExif ? layout.photoMaxHeight : canvasHeight * photoScale) - reserve;
  const photo = containSize(imageWidth, imageHeight, maxW, Math.max(1, maxH));
  const lift = sign && !hasExif ? STILL_CAPTION_SIGN_LIFT * visualScale : 0;
  const groupHeight = photo.height + gap + CAPTION_FONT_SIZE * visualScale * CAPTION_LINE_HEIGHT;
  const groupTop = (canvasHeight - groupHeight) / 2 - lift;
  const photoBox = {
    x: hasExif && !layout.stacked
      ? (canvasWidth - (photo.width + layout.gap + layout.panelWidth)) / 2
      : (canvasWidth - photo.width) / 2,
    y: groupTop,
    width: photo.width,
    height: photo.height,
  };
  const signTop = sign && !hasExif
    ? canvasHeight - (STILL_SIGNATURE_BOTTOM_INSET + STILL_SIGNATURE_HEIGHT) * visualScale
    : null;
  return {photoBox, photoMaxWidth: maxW, photoMaxHeight: maxH, signTop, lift, gap, stacked: Boolean(layout?.stacked)};
};
