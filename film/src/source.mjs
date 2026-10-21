const FUJI_FILM_MODES = new Map([
  [0x000, {label: 'Provia 标准', roll: null}],
  [0x120, {label: 'Astia 柔和', roll: 'astia'}],
  [0x200, {label: 'Velvia 鲜艳', roll: 'velvia'}],
  [0x400, {label: 'Velvia 鲜艳', roll: 'velvia'}],
  [0x500, {label: 'Pro Neg. Std', roll: 'astia'}],
  [0x501, {label: 'Pro Neg. Hi', roll: 'astia'}],
  [0x600, {label: '经典铬', roll: 'classic-chrome'}],
  [0x700, {label: 'Eterna 电影', roll: 'eterna'}],
  [0x800, {label: '经典负片', roll: 'classic-neg'}],
  [0x900, {label: 'Eterna 漂白', roll: null}],
  [0xa00, {label: '怀旧负片', roll: 'classic-neg'}],
  [0xb00, {label: 'Reala Ace', roll: null}],
]);

const FUJI_MONO = new Map([
  [0x300, {label: '黑白', roll: null}],
  [0x301, {label: '黑白 +R', roll: null}],
  [0x302, {label: '黑白 +Ye', roll: null}],
  [0x303, {label: '黑白 +G', roll: null}],
  [0x310, {label: '棕褐色', roll: null}],
  [0x500, {label: 'Acros', roll: 'acros'}],
  [0x501, {label: 'Acros +R', roll: 'acros'}],
  [0x502, {label: 'Acros +Ye', roll: 'acros'}],
  [0x503, {label: 'Acros +G', roll: 'acros'}],
]);

const readFujiTags = (bytes) => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 14) return null;
  const header = String.fromCharCode(...bytes.subarray(0, 8));
  if (header !== 'FUJIFILM') return null;
  const ifd = view.getUint32(8, true);
  if (ifd + 2 > bytes.byteLength) return null;
  const count = view.getUint16(ifd, true);
  const tags = new Map();
  for (let i = 0; i < count; i++) {
    const o = ifd + 2 + i * 12;
    if (o + 12 > bytes.byteLength) break;
    const type = view.getUint16(o + 2, true);
    if (type === 3) tags.set(view.getUint16(o, true), view.getUint16(o + 8, true));
  }
  return tags;
};

export const detectSourceLook = (makerNote) => {
  if (!makerNote || !(makerNote instanceof Uint8Array)) return null;
  const tags = readFujiTags(makerNote);
  if (!tags) return null;
  const mono = FUJI_MONO.get(tags.get(0x1003));
  if (mono) return {maker: 'fujifilm', ...mono};
  const mode = tags.has(0x1401) ? FUJI_FILM_MODES.get(tags.get(0x1401)) : null;
  if (!mode) return null;
  if (mode.roll === null && tags.get(0x1401) === 0x000) return null;
  return {maker: 'fujifilm', ...mode};
};

export const STYLED_SOURCE_STRENGTH = 0.6;

export const effectiveStrength = (rollId, strength, sourceLook) => {
  if (!sourceLook) return {color: strength, effects: strength, reason: null};
  if (sourceLook.roll && sourceLook.roll === rollId) return {color: 0, effects: strength, reason: 'same'};
  return {color: strength * STYLED_SOURCE_STRENGTH, effects: strength, reason: 'styled'};
};
