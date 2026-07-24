/**
 * 滤镜 id 列表——必须与 renderer/src/filters.ts 的 FILTERS 注册表保持同步。
 * cli 是纯 .mjs,renderer/src 是 TS 源码(未编译),两边无法直接 import,
 * 故在此维护一份平行的纯数据副本,只用于 CLI 校验与帮助文案。
 */
export const FILTER_IDS = [
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
