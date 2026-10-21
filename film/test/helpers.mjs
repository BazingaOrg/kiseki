export const chart = (width = 96, height = 64) => {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const h = x / width;
      const v = 1 - y / height;
      const s = y < height / 2 ? 0.75 : 0.25;
      const k = (n) => {
        const t = (n + h * 6) % 6;
        return v * (1 - s * Math.max(0, Math.min(t, 4 - t, 1)));
      };
      const o = (y * width + x) * 4;
      data[o] = k(5) * 255;
      data[o + 1] = k(3) * 255;
      data[o + 2] = k(1) * 255;
      data[o + 3] = 255;
    }
  }
  return {width, height, data};
};

export const flat = (r, g, b, width = 32, height = 32) => {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set([r, g, b, 255], i * 4);
  return {width, height, data};
};

export const meanRgb = (image) => {
  const sum = [0, 0, 0];
  const n = image.width * image.height;
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) sum[c] += image.data[i * 4 + c];
  return sum.map((v) => v / n);
};

export const meanChroma = (image) => {
  let s = 0;
  const n = image.width * image.height;
  for (let i = 0; i < n; i++) {
    const r = image.data[i * 4];
    const g = image.data[i * 4 + 1];
    const b = image.data[i * 4 + 2];
    s += Math.max(r, g, b) - Math.min(r, g, b);
  }
  return s / n;
};
