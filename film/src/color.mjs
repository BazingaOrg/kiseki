export const NEUTRAL_COLOR = Object.freeze({
  exp: 0,
  temp: 0,
  tint: 0,
  con: 1,
  piv: 0.45,
  black: 0,
  white: 1,
  sat: 1,
  satSh: 1,
  satHi: 1,
  shT: [0, 0, 0],
  hiT: [0, 0, 0],
  hueS: [1, 1, 1, 1, 1, 1],
  hueH: [0, 0, 0, 0, 0, 0],
  hueL: [0, 0, 0, 0, 0, 0],
  mono: 0,
  monoMix: [0.2126, 0.7152, 0.0722],
  monoTone: [0, 0, 0],
});

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smoothstep = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const fract = (x) => x - Math.floor(x);

export const srgbToLinear = (x) => (x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4));
export const linearToSrgb = (x) => {
  const v = clamp01(x);
  return v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
};

const rgbToHsv = (r, g, b, out) => {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d > 1e-10) {
    if (max === r) h = ((g - b) / d) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
    h = fract(h);
  }
  out[0] = h;
  out[1] = max > 1e-10 ? d / max : 0;
  out[2] = max;
};

const hsvToRgb = (h, s, v, out) => {
  for (let i = 0; i < 3; i++) {
    const k = [1, 2 / 3, 1 / 3][i];
    const p = Math.abs(fract(h + k) * 6 - 3);
    out[i] = v * (1 + (clamp01(p - 1) - 1) * s);
  }
};

const gain = (x, g) => (x < 0.5 ? 0.5 * Math.pow(2 * x, g) : 1 - 0.5 * Math.pow(2 - 2 * x, g));

const shoulder = (x) => {
  const t = 0.78;
  return x <= t ? x : t + (1 - t) * (1 - Math.exp(-(x - t) / (1 - t)));
};

export const resolveColor = (params) => ({...NEUTRAL_COLOR, ...params});

export const createColorTransform = (params) => {
  const p = resolveColor(params);
  const e = Math.log(0.5) / Math.log(p.piv);
  const wb = [1 + 0.2 * p.temp, 1 - 0.1 * p.tint, 1 - 0.2 * p.temp];
  const expGain = Math.pow(2, p.exp);
  const hsv = [0, 0, 0];
  const rgb = [0, 0, 0];
  return (r, g, b, out) => {
    const c = [r, g, b];
    for (let i = 0; i < 3; i++) {
      const lin = shoulder(Math.max(0, Math.pow(c[i], 2.2) * expGain * wb[i]));
      const x = Math.pow(clamp01(Math.pow(lin, 1 / 2.2)), e);
      c[i] = Math.pow(gain(x, p.con), 1 / e);
    }
    rgbToHsv(c[0], c[1], c[2], hsv);
    let hs = 0;
    let hh = 0;
    let hl = 0;
    for (let i = 0; i < 6; i++) {
      let d = Math.abs(hsv[0] * 6 - i);
      d = Math.min(d, 6 - d);
      const w = Math.max(0, 1 - d);
      hs += w * (p.hueS[i] - 1);
      hh += w * p.hueH[i];
      hl += w * p.hueL[i];
    }
    const sw = smoothstep(0, 0.25, hsv[1]);
    hsvToRgb(fract(hsv[0] + (hh * sw) / 360), clamp01(hsv[1] * (1 + hs)), clamp01(hsv[2] + hl * hsv[1]), rgb);
    const l = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
    const sk = p.sat * (p.satSh + (p.satHi - p.satSh) * smoothstep(0.15, 0.85, l));
    const shW = (1 - l) * (1 - l) * 2;
    const hiW = l * l * 2;
    for (let i = 0; i < 3; i++) rgb[i] = l + (rgb[i] - l) * sk + p.shT[i] * shW + p.hiT[i] * hiW;
    if (p.mono > 0) {
      const m = clamp01(clamp01(rgb[0]) * p.monoMix[0] + clamp01(rgb[1]) * p.monoMix[1] + clamp01(rgb[2]) * p.monoMix[2]);
      for (let i = 0; i < 3; i++) rgb[i] += (m + p.monoTone[i] * 4 * m * (1 - m) - rgb[i]) * p.mono;
    }
    for (let i = 0; i < 3; i++) out[i] = clamp01(p.black + clamp01(rgb[i]) * (p.white - p.black));
    return out;
  };
};
