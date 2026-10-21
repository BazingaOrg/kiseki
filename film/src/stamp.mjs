const SEGMENTS = {
  a: [2, 0, 6, 1.8],
  b: [8.2, 1.8, 1.8, 6.6],
  c: [8.2, 9.6, 1.8, 6.6],
  d: [2, 16.2, 6, 1.8],
  e: [0, 9.6, 1.8, 6.6],
  f: [0, 1.8, 1.8, 6.6],
  g: [2, 8.1, 6, 1.8],
};
const DIGITS = ['abcdef', 'bc', 'abged', 'abgcd', 'fgbc', 'afgcd', 'afgedc', 'abc', 'abcdefg', 'abcdfg'];
const STAMP_COLOR = [1, 0.56, 0.16];

export const stampText = (date) => {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  const yy = String(d.getFullYear() % 100).padStart(2, '0');
  return `'${yy} ${d.getMonth() + 1} ${d.getDate()}`;
};

const layoutRects = (text) => {
  const rects = [];
  let x = 0;
  for (const ch of text) {
    if (ch === ' ') {
      x += 6;
    } else if (ch === "'") {
      rects.push([x, 0, 1.8, 4.5]);
      x += 4.5;
    } else if (/\d/.test(ch)) {
      for (const s of DIGITS[Number(ch)]) {
        const [sx, sy, sw, sh] = SEGMENTS[s];
        rects.push([x + sx, sy, sw, sh]);
      }
      x += 14;
    }
  }
  return {rects, width: Math.max(0, x - 4)};
};

const boxBlur = (src, w, h, r) => {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  const n = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let k = -r; k <= r; k++) s += src[y * w + Math.min(w - 1, Math.max(0, x + k))];
      tmp[y * w + x] = s / n;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let k = -r; k <= r; k++) s += tmp[Math.min(h - 1, Math.max(0, y + k)) * w + x];
      out[y * w + x] = s / n;
    }
  }
  return out;
};

export const drawStamp = (image, text) => {
  if (!text) return image;
  const {width: W, height: H, data} = image;
  const {rects, width: unitW} = layoutRects(text);
  const scale = Math.max(11, H * 0.045) / 18;
  const pad = Math.ceil(scale * 3);
  const bw = Math.ceil(unitW * scale) + pad * 2;
  const bh = Math.ceil(18 * scale) + pad * 2;
  const ox = Math.round(W - W * 0.05 - bw);
  const oy = Math.round(H - H * 0.05 - bh);
  const core = new Float32Array(bw * bh);
  const ss = 3;
  for (const [rx, ry, rw, rh] of rects) {
    const x0 = pad + rx * scale;
    const y0 = pad + ry * scale;
    const x1 = x0 + rw * scale;
    const y1 = y0 + rh * scale;
    for (let y = Math.floor(y0); y < Math.ceil(y1); y++) {
      for (let x = Math.floor(x0); x < Math.ceil(x1); x++) {
        let hit = 0;
        for (let sy = 0; sy < ss; sy++) {
          for (let sx = 0; sx < ss; sx++) {
            const px = x + (sx + 0.5) / ss;
            const py = y + (sy + 0.5) / ss;
            if (px >= x0 && px < x1 && py >= y0 && py < y1) hit++;
          }
        }
        if (y >= 0 && y < bh && x >= 0 && x < bw) core[y * bw + x] = Math.min(1, core[y * bw + x] + hit / (ss * ss));
      }
    }
  }
  const glow = boxBlur(core, bw, bh, Math.max(1, Math.round(scale * 1.2)));
  for (let y = 0; y < bh; y++) {
    const iy = oy + y;
    if (iy < 0 || iy >= H) continue;
    for (let x = 0; x < bw; x++) {
      const ix = ox + x;
      if (ix < 0 || ix >= W) continue;
      const a = Math.min(1, core[y * bw + x] * 0.92 + glow[y * bw + x] * 0.55);
      if (a <= 0) continue;
      const o = (iy * W + ix) * 4;
      for (let c = 0; c < 3; c++) {
        const base = data[o + c] / 255;
        data[o + c] = Math.round((1 - (1 - base) * (1 - STAMP_COLOR[c] * a)) * 255);
      }
    }
  }
  return image;
};
