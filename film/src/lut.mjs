export const createLut = (size, data) => ({size, data});

export const bakeLut = (transform, size = 33) => {
  const data = new Float32Array(size * size * size * 3);
  const out = [0, 0, 0];
  let o = 0;
  for (let b = 0; b < size; b++) {
    for (let g = 0; g < size; g++) {
      for (let r = 0; r < size; r++) {
        transform(r / (size - 1), g / (size - 1), b / (size - 1), out);
        data[o++] = out[0];
        data[o++] = out[1];
        data[o++] = out[2];
      }
    }
  }
  return createLut(size, data);
};

export const sampleLut = (lut, r, g, b, out) => {
  const n = lut.size;
  const d = lut.data;
  const m = n - 1;
  const fr = Math.min(Math.max(r, 0), 1) * m;
  const fg = Math.min(Math.max(g, 0), 1) * m;
  const fb = Math.min(Math.max(b, 0), 1) * m;
  const r0 = Math.min(Math.floor(fr), m - 1);
  const g0 = Math.min(Math.floor(fg), m - 1);
  const b0 = Math.min(Math.floor(fb), m - 1);
  const tr = fr - r0;
  const tg = fg - g0;
  const tb = fb - b0;
  const s1 = 3;
  const s2 = n * 3;
  const s3 = n * n * 3;
  const base = b0 * s3 + g0 * s2 + r0 * s1;
  for (let c = 0; c < 3; c++) {
    const i = base + c;
    const c00 = d[i] + (d[i + s1] - d[i]) * tr;
    const c10 = d[i + s2] + (d[i + s2 + s1] - d[i + s2]) * tr;
    const c01 = d[i + s3] + (d[i + s3 + s1] - d[i + s3]) * tr;
    const c11 = d[i + s3 + s2] + (d[i + s3 + s2 + s1] - d[i + s3 + s2]) * tr;
    const c0 = c00 + (c10 - c00) * tg;
    const c1 = c01 + (c11 - c01) * tg;
    out[c] = c0 + (c1 - c0) * tb;
  }
  return out;
};

export const parseCube = (text) => {
  let size = 0;
  const values = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split(/\s+/);
    if (parts[0] === 'LUT_3D_SIZE') size = Number(parts[1]);
    else if (/^[-+.\d]/.test(parts[0]) && parts.length === 3) values.push(Number(parts[0]), Number(parts[1]), Number(parts[2]));
  }
  if (!size || values.length !== size * size * size * 3) throw new Error('invalid .cube LUT');
  return createLut(size, Float32Array.from(values));
};

export const formatCube = (lut, title) => {
  const lines = [`TITLE "${title}"`, `LUT_3D_SIZE ${lut.size}`, 'DOMAIN_MIN 0 0 0', 'DOMAIN_MAX 1 1 1'];
  for (let i = 0; i < lut.data.length; i += 3) {
    lines.push(`${lut.data[i].toFixed(6)} ${lut.data[i + 1].toFixed(6)} ${lut.data[i + 2].toFixed(6)}`);
  }
  return `${lines.join('\n')}\n`;
};

const toBase64 = (bytes) => {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
};

const fromBase64 = (text) => {
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(text, 'base64'));
  const s = atob(text);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return bytes;
};

export const encodeLut = (lut) => {
  const words = new Uint16Array(lut.data.length);
  for (let i = 0; i < words.length; i++) words[i] = Math.round(Math.min(Math.max(lut.data[i], 0), 1) * 65535);
  const bytes = new Uint8Array(words.length * 2);
  for (let i = 0; i < words.length; i++) {
    bytes[i * 2] = words[i] & 255;
    bytes[i * 2 + 1] = words[i] >> 8;
  }
  return {size: lut.size, data: toBase64(bytes)};
};

export const decodeLut = (encoded) => {
  const bytes = fromBase64(encoded.data);
  const data = new Float32Array(bytes.length / 2);
  for (let i = 0; i < data.length; i++) data[i] = (bytes[i * 2] | (bytes[i * 2 + 1] << 8)) / 65535;
  return createLut(encoded.size, data);
};
