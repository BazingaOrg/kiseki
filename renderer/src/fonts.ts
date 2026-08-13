import {cancelRender, continueRender, delayRender} from 'remotion';
import notoSerifJP from './fonts/NotoSerifJP-VF.ttf';
import notoSerifSC from './fonts/NotoSerifSC-VF.ttf';
import notoSerif from './fonts/NotoSerif-VF.ttf';
import notoSansJP from './fonts/NotoSansJP-VF.woff2';
import notoSansSC from './fonts/NotoSansSC-VF.woff2';
import notoSans from './fonts/NotoSans-VF.woff2';
import {FONT_LOAD_PLAN} from './fontLoadPlan';
import type {FontFamily} from './theme';

const FONT_URLS = {
  'Noto Serif JP': notoSerifJP,
  'Noto Serif SC': notoSerifSC,
  'Noto Serif': notoSerif,
  'Noto Sans JP': notoSansJP,
  'Noto Sans SC': notoSansSC,
  'Noto Sans': notoSans,
} as const;

export const fontsForFamily = (family: FontFamily) =>
  FONT_LOAD_PLAN[family].map((spec) => ({
    ...spec,
    url: FONT_URLS[spec.family],
    descriptors: {weight: '200 900'} as FontFaceDescriptors,
  }));

const loadFont = (family: string, url: string, descriptors?: FontFaceDescriptors, format = 'truetype-variations') => {
  if (typeof document === 'undefined') return;
  const handle = delayRender(`loading font ${family}`, {
    timeoutInMilliseconds: 180_000,
    retries: 2,
  });
  const face = new FontFace(family, `url(${url}) format('${format}')`, descriptors);
  face
    .load()
    .then(() => {
      (document.fonts as unknown as {add(f: FontFace): void}).add(face);
      continueRender(handle);
    })
    .catch((err) => cancelRender(err));
};

const loaded = new Set<FontFamily>();

export const ensureFonts = (family: FontFamily = 'serif') => {
  if (loaded.has(family)) return;
  loaded.add(family);
  for (const spec of fontsForFamily(family)) {
    loadFont(spec.family, spec.url, spec.descriptors, spec.format);
  }
};
