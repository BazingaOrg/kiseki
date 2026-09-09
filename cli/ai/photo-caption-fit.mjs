import {
  CAPTION_FONT_SIZE,
  CAPTION_FONT_WEIGHT,
  captionMaxTextWidth,
  layoutStillCaption,
  layoutTopBandCaption,
  letterSpacingFor,
  stillCaptionMetrics,
  videoSubjectTop,
} from '../../renderer/src/photoCaptionLayout.mjs';

const CAPTION_FONT_FAMILY = `'Noto Serif SC', 'Noto Serif JP', 'Noto Serif', serif`;

export const measureCaptionWidth = async (page, {text, fontFamily, fontSize, fontWeight, letterSpacing}) => {
  if (!page?.evaluate) throw new Error('caption-measure-unavailable');
  await page.evaluate(async ({fontFamily, fontSize, fontWeight}) => {
    try {
      if (document.fonts?.load) {
        await document.fonts.load(`${fontWeight} ${fontSize}px ${fontFamily}`);
      }
      await document.fonts?.ready;
    } catch {
      // about:blank cannot fetch local font files; measure with the fallback stack.
    }
  }, {fontFamily, fontSize, fontWeight});
  return page.evaluate(({text, fontFamily, fontSize, fontWeight, letterSpacing}) => {
    const el = document.createElement('span');
    el.textContent = text;
    el.style.cssText = [
      'position:absolute',
      'left:-99999px',
      'top:0',
      'white-space:nowrap',
      `font-family:${fontFamily}`,
      `font-size:${fontSize}px`,
      `font-weight:${fontWeight}`,
      `letter-spacing:${letterSpacing}`,
    ].join(';');
    document.body.appendChild(el);
    const width = el.getBoundingClientRect().width;
    el.remove();
    return width;
  }, {text, fontFamily, fontSize, fontWeight, letterSpacing});
};

export const captionPageFromBrowser = async (browser) => {
  if (!browser?.newPage) return null;
  const page = await browser.newPage({
    context: () => null,
    logLevel: 'error',
    indent: false,
    pageIndex: 0,
    onBrowserLog: null,
    onLog: null,
  });
  if (typeof page.goto === 'function') {
    await page.goto({url: 'about:blank', timeout: 10_000});
  }
  return page;
};

const measuredWidth = async ({page, measureWidth, text, visualScale, codePoints}) => {
  const fontSize = CAPTION_FONT_SIZE * visualScale;
  const letterSpacing = `${letterSpacingFor(codePoints)}em`;
  if (typeof measureWidth === 'function') {
    return measureWidth({text, fontFamily: CAPTION_FONT_FAMILY, fontSize, fontWeight: CAPTION_FONT_WEIGHT, letterSpacing});
  }
  return measureCaptionWidth(page, {
    text,
    fontFamily: CAPTION_FONT_FAMILY,
    fontSize,
    fontWeight: CAPTION_FONT_WEIGHT,
    letterSpacing,
  });
};

export const fitTopCaption = async ({
  text,
  canvasWidth,
  canvasHeight,
  photoScale,
  imageWidth,
  imageHeight,
  visualScale,
  hasExif = false,
  templateId = null,
  src = '',
  motionZoom = 1,
  page = null,
  measureWidth,
}) => {
  const codePoints = [...text].length;
  const subjectTop = videoSubjectTop({
    canvasWidth, canvasHeight, photoScale, imageWidth, imageHeight, hasExif, templateId, src, motionZoom,
  });
  const regionWidth = hasExif && templateId !== 'filmstrip' && templateId !== 'polaroid'
    ? captionMaxTextWidth(canvasWidth * 0.52, visualScale)
    : captionMaxTextWidth(canvasWidth, visualScale);
  const measuredAtMax = await measuredWidth({page, measureWidth, text, visualScale, codePoints});
  return layoutTopBandCaption({
    canvasWidth,
    canvasHeight,
    visualScale,
    subjectTop,
    maxTextWidth: regionWidth,
    measuredAtMax,
    codePoints,
  });
};

export const fitStillCaption = async ({
  text,
  canvasWidth,
  canvasHeight,
  photoScale,
  imageWidth,
  imageHeight,
  visualScale,
  hasExif,
  sign,
  page = null,
  measureWidth,
}) => {
  const codePoints = [...text].length;
  const metrics = stillCaptionMetrics({
    canvasWidth, canvasHeight, visualScale, photoScale, imageWidth, imageHeight, hasExif, sign,
  });
  const maxTextWidth = captionMaxTextWidth(metrics.photoBox.width, visualScale);
  const measuredAtMax = await measuredWidth({page, measureWidth, text, visualScale, codePoints});
  return layoutStillCaption({
    canvasWidth,
    canvasHeight,
    visualScale,
    photoBox: metrics.photoBox,
    maxTextWidth,
    measuredAtMax,
    codePoints,
    signTop: metrics.signTop,
  });
};
