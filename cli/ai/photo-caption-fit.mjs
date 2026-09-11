import {readFile} from 'node:fs/promises';
import {normalizeTemplateId} from '../templates.mjs';
import {
  CAPTION_FONT_SIZE,
  CAPTION_FONT_WEIGHT,
  captionMaxTextWidth,
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

const sansFontPages = new WeakMap();

const ensureSansCaptionFonts = async (page) => {
  if (!page?.evaluate) throw new Error('caption-measure-unavailable');
  if (!sansFontPages.has(page)) {
    const loading = Promise.all(['NotoSans', 'NotoSansSC', 'NotoSansJP'].map(async (name) => ({
      family: name === 'NotoSans' ? 'Noto Sans' : name === 'NotoSansSC' ? 'Noto Sans SC' : 'Noto Sans JP',
      data: (await readFile(new URL(`../../renderer/src/fonts/${name}-VF.woff2`, import.meta.url))).toString('base64'),
    }))).then((fonts) => page.evaluate(async (fonts) => {
      for (const {family, data} of fonts) {
        const face = new FontFace(family, `url(data:font/woff2;base64,${data})`, {weight: '200 900'});
        document.fonts.add(await face.load());
      }
    }, fonts));
    sansFontPages.set(page, loading);
  }
  await sansFontPages.get(page);
};

const measuredWidth = async ({page, measureWidth, text, visualScale, codePoints, defaultStyle = false, fontFamily = CAPTION_FONT_FAMILY}) => {
  const fontSize = CAPTION_FONT_SIZE * visualScale;
  const letterSpacing = `${defaultStyle ? 0.02 : letterSpacingFor(codePoints)}em`;
  const fontWeight = defaultStyle ? 400 : CAPTION_FONT_WEIGHT;
  if (typeof measureWidth === 'function') {
    return measureWidth({text, fontFamily, fontSize, fontWeight, letterSpacing});
  }
  if (defaultStyle) await ensureSansCaptionFonts(page);
  return measureCaptionWidth(page, {
    text,
    fontFamily,
    fontSize,
    fontWeight,
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
  sign = false,
  templateId = null,
  src = '',
  motionZoom = 1,
  page = null,
  measureWidth,
}) => {
  const codePoints = [...text].length;
  const subjectTop = videoSubjectTop({
    canvasWidth, canvasHeight, photoScale, imageWidth, imageHeight, hasExif, sign, templateId, src, motionZoom,
  });
  const regionWidth = hasExif && templateId !== 'filmstrip' && templateId !== 'polaroid'
    ? captionMaxTextWidth(canvasWidth * 0.52, visualScale)
    : captionMaxTextWidth(canvasWidth, visualScale);
  const defaultStyle = !normalizeTemplateId(templateId);
  const fontFamily = defaultStyle
    ? (/^[ -ɏ -⁯]*$/u.test(text) ? "'Noto Sans', sans-serif" : /[぀-ヿ]/u.test(text) ? "'Noto Sans JP', 'Noto Sans SC', 'Noto Sans', sans-serif" : "'Noto Sans SC', 'Noto Sans JP', 'Noto Sans', sans-serif")
    : CAPTION_FONT_FAMILY;
  const measuredAtMax = await measuredWidth({page, measureWidth, text, visualScale, codePoints, defaultStyle, fontFamily});
  return layoutTopBandCaption({
    canvasWidth,
    canvasHeight,
    visualScale,
    subjectTop,
    maxTextWidth: regionWidth,
    measuredAtMax,
    codePoints,
    tracking: defaultStyle ? 0.02 : undefined,
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
  const maxTextWidth = captionMaxTextWidth(canvasWidth, visualScale);
  const measuredAtMax = await measuredWidth({page, measureWidth, text, visualScale, codePoints});
  return layoutTopBandCaption({
    canvasWidth,
    canvasHeight,
    visualScale,
    subjectTop: metrics.photoBox.y,
    maxTextWidth,
    measuredAtMax,
    codePoints,
  });
};
