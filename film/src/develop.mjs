import {createColorTransform} from './color.mjs';
import {grainScale, grainSample} from './grain.mjs';
import {bakeLut, decodeLut, sampleLut} from './lut.mjs';
import {getRoll} from './rolls.mjs';
import {effectiveStrength} from './source.mjs';
import {drawStamp, stampText} from './stamp.mjs';
import {FITTED_LUTS} from '../luts/index.mjs';

const lutCache = new Map();

export const lutForRoll = (roll) => {
  if (lutCache.has(roll.id)) return lutCache.get(roll.id);
  const fitted = roll.lut ? FITTED_LUTS[roll.lut] : null;
  const lut = fitted ? decodeLut(fitted) : bakeLut(createColorTransform(roll.color));
  lutCache.set(roll.id, lut);
  return lut;
};

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const blur1d = (src, w, h, radius, horizontal) => {
  const out = new Float32Array(src.length);
  const n = 2 * radius + 1;
  const len = horizontal ? w : h;
  const lines = horizontal ? h : w;
  for (let line = 0; line < lines; line++) {
    for (let c = 0; c < 3; c++) {
      const at = (i) => {
        const k = Math.min(len - 1, Math.max(0, i));
        return src[(horizontal ? line * w + k : k * w + line) * 3 + c];
      };
      let sum = 0;
      for (let i = -radius; i <= radius; i++) sum += at(i);
      for (let i = 0; i < len; i++) {
        out[(horizontal ? line * w + i : i * w + line) * 3 + c] = sum / n;
        sum += at(i + radius + 1) - at(i - radius);
      }
    }
  }
  return out;
};

const gaussianish = (src, w, h, radius) => {
  let buf = src;
  for (let pass = 0; pass < 3; pass++) {
    buf = blur1d(buf, w, h, radius, true);
    buf = blur1d(buf, w, h, radius, false);
  }
  return buf;
};

const highlightGlow = (graded, W, H) => {
  const f = 4;
  const w = Math.max(2, Math.ceil(W / f));
  const h = Math.max(2, Math.ceil(H / f));
  const small = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let dy = 0; dy < f; dy++) {
        const sy = y * f + dy;
        if (sy >= H) break;
        for (let dx = 0; dx < f; dx++) {
          const sx = x * f + dx;
          if (sx >= W) break;
          const o = (sy * W + sx) * 3;
          const m = smoothstep(0.62, 1, Math.max(graded[o], graded[o + 1], graded[o + 2]));
          r += graded[o] * m;
          g += graded[o + 1] * m;
          b += graded[o + 2] * m;
          n++;
        }
      }
      const o = (y * w + x) * 3;
      small[o] = r / n;
      small[o + 1] = g / n;
      small[o + 2] = b / n;
    }
  }
  const radius = Math.max(1, Math.round(Math.max(w, h) / 110));
  return {w, h, f, data: gaussianish(small, w, h, radius)};
};

const sampleGlow = (glow, x, y, out) => {
  const gx = Math.min(glow.w - 1, Math.max(0, (x + 0.5) / glow.f - 0.5));
  const gy = Math.min(glow.h - 1, Math.max(0, (y + 0.5) / glow.f - 0.5));
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const x1 = Math.min(glow.w - 1, x0 + 1);
  const y1 = Math.min(glow.h - 1, y0 + 1);
  const tx = gx - x0;
  const ty = gy - y0;
  const d = glow.data;
  for (let c = 0; c < 3; c++) {
    const a = d[(y0 * glow.w + x0) * 3 + c];
    const b = d[(y0 * glow.w + x1) * 3 + c];
    const e = d[(y1 * glow.w + x0) * 3 + c];
    const g = d[(y1 * glow.w + x1) * 3 + c];
    out[c] = (a + (b - a) * tx) * (1 - ty) + (e + (g - e) * tx) * ty;
  }
  return out;
};

export const develop = (image, {roll: rollId, strength = 1, sourceLook = null, grain = true, seed = 1, date = null}) => {
  const roll = getRoll(rollId);
  const {width: W, height: H} = image;
  const out = {width: W, height: H, data: new Uint8ClampedArray(image.data)};
  if (!roll || strength <= 0) return out;
  const amount = effectiveStrength(roll.id, Math.min(1, strength), sourceLook);
  const fx = roll.effects;
  const lut = lutForRoll(roll);
  const src = image.data;
  const graded = new Float32Array(W * H * 3);
  const px = [0, 0, 0];
  for (let i = 0, j = 0; i < src.length; i += 4, j += 3) {
    const r = src[i] / 255;
    const g = src[i + 1] / 255;
    const b = src[i + 2] / 255;
    if (amount.color > 0) {
      sampleLut(lut, r, g, b, px);
      graded[j] = r + (px[0] - r) * amount.color;
      graded[j + 1] = g + (px[1] - g) * amount.color;
      graded[j + 2] = b + (px[2] - b) * amount.color;
    } else {
      graded[j] = r;
      graded[j + 1] = g;
      graded[j + 2] = b;
    }
  }
  const e = amount.effects;
  const halation = fx.halation * e;
  const bloom = fx.bloom * e;
  const glow = halation > 0.001 || bloom > 0.001 ? highlightGlow(graded, W, H) : null;
  const vignette = fx.vignette * e;
  const flash = fx.flash * e;
  const grainAmount = grain ? fx.grain * e : 0;
  const scale = grainScale(H, fx.grainSize);
  const ax = W / H;
  const diag = Math.hypot(ax * 0.5, 0.5);
  const hc = fx.halationColor;
  const gp = [0, 0, 0];
  const c = [0, 0, 0];
  const data = out.data;
  for (let y = 0; y < H; y++) {
    const v = (y + 0.5) / H - 0.5;
    for (let x = 0; x < W; x++) {
      const j = (y * W + x) * 3;
      c[0] = graded[j];
      c[1] = graded[j + 1];
      c[2] = graded[j + 2];
      if (glow) {
        sampleGlow(glow, x, y, gp);
        const inside = 1 - smoothstep(0.62, 1, Math.max(c[0], c[1], c[2]));
        for (let k = 0; k < 3; k++) {
          const h = Math.min(1, Math.max(0, gp[k] * hc[k] * halation * 3.2 * inside));
          c[k] = 1 - (1 - c[k]) * (1 - h) + gp[k] * bloom * 0.6;
        }
      }
      const u = ((x + 0.5) / W - 0.5) * ax;
      const d = Math.hypot(u, v) / diag;
      let mul = 1 - vignette * 0.75 * smoothstep(0.3, 1.05, d);
      if (flash > 0) mul *= 1 - flash * 0.3 * smoothstep(0.45, 1, d);
      const lift = flash > 0 ? flash * 0.9 * (1 - smoothstep(0, 0.8, d)) : 0;
      for (let k = 0; k < 3; k++) {
        const v = c[k] * mul;
        c[k] = v + lift * v * (1 - v);
      }
      if (grainAmount > 0) {
        const n = grainSample(x, y, scale, seed);
        const l = Math.min(1, Math.max(0, 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]));
        const k = grainAmount * 0.22 * (0.25 + 3 * l * (1 - l));
        if (fx.grainColor > 0) {
          const gc = fx.grainColor;
          c[0] += (n + (grainSample(x * 1.07 + 31, y * 1.07 + 17, scale, seed + 1) - n) * gc) * k;
          c[1] += (n + (grainSample(x * 0.93 + 57, y * 0.93 + 11, scale, seed + 2) - n) * gc) * k;
          c[2] += (n + (grainSample(x * 1.03 + 13, y * 0.97 + 71, scale, seed + 3) - n) * gc) * k;
        } else {
          c[0] += n * k;
          c[1] += n * k;
          c[2] += n * k;
        }
      }
      const o = (y * W + x) * 4;
      data[o] = c[0] * 255;
      data[o + 1] = c[1] * 255;
      data[o + 2] = c[2] * 255;
    }
  }
  if (roll.stamp && date) drawStamp(out, stampText(date));
  return out;
};
