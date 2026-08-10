/**
 * 模板 id 与展示信息——必须与 renderer/src/templates.ts 的 TEMPLATES 注册表保持同步.
 * cli 是纯 .mjs,renderer/src 是 TS 源码(未编译),两边无法直接 import,
 * 故在此维护一份平行的纯数据副本,只用于 CLI 校验/帮助/web 端点;
 * 呈现字段(transition/captions/chapterCard)只存在于渲染器注册表,渲染时按 id 解析.
 */
export const TEMPLATES = [
  {id: 'album', name: '相册翻页', description: '翻页式切换、题签字幕、默认呈现'},
  {id: 'news-cut', name: '新闻快切', description: '干脆的硬切、黑体醒目大号字幕'},
  {id: 'slow-cinema', name: '电影舒缓', description: '缓慢交叉淡化、细字极简字幕、照片缓推'},
];

export const TEMPLATE_IDS = TEMPLATES.map((template) => template.id);

export const normalizeTemplateId = (raw) => {
  if (typeof raw !== 'string') return null;
  return TEMPLATE_IDS.includes(raw) ? raw : null;
};
