const hash = (x, y, seed) => {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
};

const valueNoise = (x, y, seed) => {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  let fx = x - ix;
  let fy = y - iy;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy, seed);
  const b = hash(ix + 1, iy, seed);
  const c = hash(ix, iy + 1, seed);
  const d = hash(ix + 1, iy + 1, seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
};

export const grainScale = (height, size) => size * Math.max(height / 1000, 0.35);

export const grainSample = (x, y, scale, seed) => {
  const px = x / scale;
  const py = y / scale;
  return (valueNoise(px, py, seed) - 0.5) * 0.7 + (hash(Math.floor(px * 1.7), Math.floor(py * 1.7), seed + 7919) - 0.5) * 0.6;
};

export const grainOverlay = (width, height, {amount, size = 1, color = 0, seed = 1, scale: fixedScale}) => {
  const data = new Uint8ClampedArray(width * height * 4);
  const scale = fixedScale ?? grainScale(height, size);
  const k = amount * 0.22 * 1.2 * 255;
  let o = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const n = grainSample(x, y, scale, seed);
      let r = n;
      let g = n;
      let b = n;
      if (color > 0) {
        r += (grainSample(x * 1.07 + 31, y * 1.07 + 17, scale, seed + 1) - n) * color;
        g += (grainSample(x * 0.93 + 57, y * 0.93 + 11, scale, seed + 2) - n) * color;
        b += (grainSample(x * 1.03 + 13, y * 0.97 + 71, scale, seed + 3) - n) * color;
      }
      data[o++] = 128 + r * k;
      data[o++] = 128 + g * k;
      data[o++] = 128 + b * k;
      data[o++] = 255;
    }
  }
  return {width, height, data};
};
