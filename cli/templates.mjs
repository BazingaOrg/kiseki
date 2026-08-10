/**
 * 模板 id 与展示信息——必须与 renderer/src/templates.ts 的 TEMPLATES 注册表保持同步.
 * cli 是纯 .mjs,renderer/src 是 TS 源码(未编译),两边无法直接 import,
 * 故在此维护一份平行的纯数据副本,用于 CLI 校验/帮助/渲染时选 composition;
 * 呈现字段(transition/motion/captions/chapterCard/fontFamily)只存在于渲染器
 * 注册表,渲染时按 id 解析.
 */
export const TEMPLATES = [
  {id: 'news-cut', name: '新闻快切', description: '干脆的硬切、黑体醒目大号字幕', composition: 'Diary'},
  {id: 'polaroid', name: '拍立得', description: '白色相框、错落旋转的拍立得卡片', composition: 'PolaroidWall'},
  {id: 'slow-cinema', name: '电影舒缓', description: '缓慢交叉淡化、细字极简字幕、照片缓推', composition: 'Diary'},
];

export const TEMPLATE_IDS = TEMPLATES.map((template) => template.id);

export const normalizeTemplateId = (raw) => {
  if (typeof raw !== 'string') return null;
  return TEMPLATE_IDS.includes(raw) ? raw : null;
};

/** 模板对应的渲染 composition;无模板/未知 id 一律回落到默认 Diary. */
export const resolveTemplateComposition = (templateId) => {
  const template = TEMPLATES.find((item) => item.id === templateId);
  return template?.composition ?? 'Diary';
};
