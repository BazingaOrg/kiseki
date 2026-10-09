import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import opentype from 'opentype.js';

export class SignatureError extends Error {}

const FONT_SIZE = 180;
const INNER_WIDTH = 640;
const INNER_HEIGHT = 180;
const PAD = 24;
const MAX_GRAPHEMES = 24;
const fontsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fonts');
const fontCache = new Map();

const graphemes = (text) => [...new Intl.Segmenter(undefined, {granularity: 'grapheme'}).segment(text)].map((part) => part.segment);

const loadFont = (fileName) => {
  if (!fontCache.has(fileName)) {
    fontCache.set(fileName, opentype.parse(fs.readFileSync(path.join(fontsDir, fileName))));
  }
  return fontCache.get(fileName);
};

export const normalizeSignatureName = (name) => {
  if (typeof name !== 'string') throw new SignatureError('名字需要是文字');
  const text = name.normalize('NFC').trim();
  if (!text) throw new SignatureError('先写一个名字');
  if (/[\u0000-\u001f]/.test(text)) throw new SignatureError('名字不能换行');
  if (graphemes(text).length > MAX_GRAPHEMES) throw new SignatureError('名字最长 24 个字');
  return text;
};

const bake = (fontPath, tx, ty, scale) => {
  const next = new opentype.Path();
  for (const command of fontPath.commands) {
    const mapped = {type: command.type};
    for (const key of ['x', 'y', 'x1', 'y1', 'x2', 'y2']) {
      if (command[key] === undefined) continue;
      const origin = key.startsWith('x') ? tx : ty;
      mapped[key] = Math.round((origin + command[key] * scale) * 100) / 100;
    }
    next.commands.push(mapped);
  }
  return next.toPathData(2);
};

export const renderSignatureSvg = (name) => {
  const text = normalizeSignatureName(name);
  const font = loadFont(/\p{Script=Han}/u.test(text) ? 'MaShanZheng-Regular.ttf' : 'Sacramento-Regular.ttf');
  const missing = [];
  const glyphPaths = [];
  let cursor = 0;
  for (const cluster of graphemes(text)) {
    if (/^\s+$/u.test(cluster)) {
      cursor += FONT_SIZE * 0.32 * cluster.length;
      continue;
    }
    const glyphs = font.stringToGlyphs(cluster);
    if (!glyphs.length || glyphs.some((glyph) => glyph.index === 0)) {
      missing.push(cluster);
      cursor += FONT_SIZE * 0.42;
      continue;
    }
    glyphPaths.push(...font.getPaths(cluster, cursor, 0, FONT_SIZE, {kerning: true}));
    cursor += font.getAdvanceWidth(cluster, FONT_SIZE, {kerning: true}) || FONT_SIZE * 0.42;
  }
  if (missing.length > 0) throw new SignatureError(`写不出这些字：${[...new Set(missing)].join('')}`);
  if (glyphPaths.length === 0) throw new SignatureError('写不出签名');

  const boxes = glyphPaths.map((item) => item.getBoundingBox());
  const box = {
    x1: Math.min(...boxes.map((item) => item.x1)),
    y1: Math.min(...boxes.map((item) => item.y1)),
    x2: Math.max(...boxes.map((item) => item.x2)),
    y2: Math.max(...boxes.map((item) => item.y2)),
  };
  const rawWidth = Math.max(box.x2 - box.x1, 1);
  const rawHeight = Math.max(box.y2 - box.y1, 1);
  const scale = Math.min(INNER_WIDTH / rawWidth, INNER_HEIGHT / rawHeight);
  const tx = PAD + (INNER_WIDTH - rawWidth * scale) / 2 - box.x1 * scale;
  const ty = PAD + (INNER_HEIGHT - rawHeight * scale) / 2 - box.y1 * scale;
  const paths = glyphPaths.map((item) => bake(item, tx, ty, scale)).filter((d) => d.trim());
  if (paths.length === 0) throw new SignatureError('写不出签名');
  const body = paths.map((d) => `<path fill="currentColor" fill-rule="evenodd" d="${d}"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${INNER_WIDTH + PAD * 2} ${INNER_HEIGHT + PAD * 2}">${body}</svg>`;
};
