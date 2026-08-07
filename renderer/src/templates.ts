/**
 * 呈现层模板注册表(权威)。模板只描述"怎么动、怎么呈现":
 * 转场、字幕/歌词呈现、章节卡样式。滤镜/背景/签名/文案/结构开关
 * 都不归模板(见 docs/plans/2026-08-07-template-system.md)。
 *
 * cli/templates.mjs 有平行的 id/名称镜像,只用于 CLI 校验与帮助;
 * 呈现字段只在这里定义,渲染器按 meta.templateId 自行解析。
 */

import type {TransitionSpec} from './types';

export type TemplateTransition = 'album' | 'cut' | 'crossfade';

export interface TemplateCaptionsStyle {
  /** 1080p 基准字号 */
  fontSize?: number;
  fontWeight?: number;
  letterSpacing?: string;
  /** 单行超长时的紧凑字距 */
  letterSpacingCompact?: string;
  /** 入场位移(px,1080p 基准) */
  riseDistance?: number;
}

export interface TemplateChapterCardStyle {
  fontSize?: number;
  letterSpacing?: string;
  riseDistance?: number;
}

export interface TemplateMotion {
  type: 'kenburns';
  /** 最大缩放倍率(1 = 不动;1.06 = 缓慢推近 6%) */
  zoom: number;
  /** 推近时的平移方向;'random' 按照片 src 稳定分配,保证每次渲染一致 */
  pan: 'center' | 'left' | 'right' | 'up' | 'down' | 'random';
}

export interface Template {
  id: string;
  name: string;
  description: string;
  /** L1 只有 Diary;L2 可指向新 composition */
  composition: 'Diary';
  /** 照片切换默认;显式配置的逐 clip transition 会被模板取代,chapter 卡保持自身节奏 */
  transition: TemplateTransition;
  /** 照片运镜;缺省照片保持静态(克制展陈风格) */
  motion?: TemplateMotion;
  captions?: TemplateCaptionsStyle;
  chapterCard?: TemplateChapterCardStyle;
}

export const TEMPLATES: Template[] = [
  {
    id: 'album',
    name: '相册翻页',
    description: '翻页式切换、题签字幕、默认呈现',
    composition: 'Diary',
    transition: 'album',
  },
  {
    id: 'news-cut',
    name: '新闻快切',
    description: '干脆的硬切、醒目大号字幕',
    composition: 'Diary',
    transition: 'cut',
    captions: {
      fontSize: 44,
      fontWeight: 700,
      letterSpacing: '0.04em',
      letterSpacingCompact: '0.03em',
      riseDistance: 4,
    },
    chapterCard: {
      fontSize: 34,
      letterSpacing: '0.06em',
    },
  },
  {
    id: 'slow-cinema',
    name: '电影舒缓',
    description: '缓慢交叉淡化、细字极简字幕、照片缓推',
    composition: 'Diary',
    transition: 'crossfade',
    motion: {type: 'kenburns', zoom: 1.06, pan: 'random'},
    captions: {
      fontSize: 32,
      fontWeight: 300,
      letterSpacing: '0.2em',
      letterSpacingCompact: '0.12em',
      riseDistance: 12,
    },
    chapterCard: {
      fontSize: 56,
      letterSpacing: '0.16em',
      riseDistance: 16,
    },
  },
];

export const templateById = (id: string | undefined): Template | undefined =>
  TEMPLATES.find((template) => template.id === id);

// 模板转场 id → TransitionSpec 的规范时长(与 plan.py 用 config 默认值产出的
// 一致:album 0.4s / crossfade 0.6s;cut 硬切无淡化)。timeline 本身不携带
// album_fade/crossfade 配置值,渲染器只能按规范值解析。
const TEMPLATE_TRANSITION_DURATIONS = {album: 0.4, cut: 0, crossfade: 0.6} as const;

export interface ResolvedTemplatePresentation {
  /** 照片切换 spec;undefined 时逐 clip 用 timeline 里的 transition */
  transition: TransitionSpec | undefined;
  /** 照片运镜;undefined 时照片保持静态 */
  motion: TemplateMotion | undefined;
  captions: TemplateCaptionsStyle | undefined;
  chapterCard: TemplateChapterCardStyle | undefined;
}

/** 按 meta.templateId 解析呈现层样式;未知/缺省 id 一律回落为"不应用模板"。 */
export const resolveTemplatePresentation = (templateId: string | undefined): ResolvedTemplatePresentation => {
  const template = templateById(templateId);
  if (!template) {
    return {transition: undefined, motion: undefined, captions: undefined, chapterCard: undefined};
  }
  return {
    transition: {type: template.transition, duration: TEMPLATE_TRANSITION_DURATIONS[template.transition]},
    motion: template.motion,
    captions: template.captions,
    chapterCard: template.chapterCard,
  };
};
