/**
 * 滤镜 id 列表——必须与 renderer/src/filters.ts 的 FILTERS 注册表保持同步.
 * cli 是纯 .mjs,renderer/src 是 TS 源码(未编译),两边无法直接 import,
 * 故在此维护一份平行的纯数据副本,只用于 CLI 校验与帮助文案.
 */
export const FILTER_IDS = [
  'fuji-classic-chrome',
  'fuji-classic-neg',
  'ricoh-positive',
  'ricoh-negative',
  'leica-classic',
  'kodak-portra-400',
  'kodak-gold-200',
  'fuji-velvia-50',
  'ilford-hp5',
  'faded',
  'warm',
  'cool',
  'mono',
  'vintage',
  'vignette',
  'teal-orange',
  'riso',
  'film',
];

/**
 * Accept the two unambiguous spellings users commonly type for the only
 * hyphenated registry id. All pipeline consumers receive the registry id.
 */
const FILTER_ALIASES = new Map([
  ['tealorange', 'teal-orange'],
  ['teal_orange', 'teal-orange'],
]);

export const normalizeFilterId = (raw) => {
  if (typeof raw !== 'string') return null;
  const id = FILTER_ALIASES.get(raw) ?? raw;
  return FILTER_IDS.includes(id) ? id : null;
};
