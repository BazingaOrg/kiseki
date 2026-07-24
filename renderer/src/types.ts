import type {StillExif} from './ExifPanel';

export type TransitionSpec = {
  type: 'album' | 'crossfade' | 'cut' | 'none';
  duration: number; // seconds; cut/none 为 0
};

/**
 * @deprecated 仅用于读取旧版 timeline。渲染器忽略所有 motion 字段,照片几何始终保持不变。
 */
export type MotionSpec = {
  type: 'kenburns' | 'none';
  from: number;
  to: number;
};

export type PhotoClip = {
  kind?: 'photo';
  src: string;
  start: number; // seconds; switch point = crossfade midpoint
  end: number;
  transition: TransitionSpec;
  /** @deprecated 仅供 timeline v1 兼容;渲染时为 no-op。 */
  motion: MotionSpec;
  /** 渲染时覆盖注入的 EXIF 展签数据;无内容或未开启 --exif 时为空 */
  exif?: StillExif | null;
  /** 渲染时覆盖注入的滤镜;id 见 renderer/src/filters.ts 注册表,intensity 缺省用滤镜自身默认值 */
  filter?: {id: string; intensity?: number} | null;
};

export type ChapterClip = {kind: 'chapter'; text: string; start: number; end: number};
export type VisualClip = PhotoClip | ChapterClip | {kind: string; start: number; end: number};

export type SubtitleLine = {
  text: string;
  lang: 'ja' | 'zh' | 'en' | 'mixed';
  start: number;
  end: number;
  confidence: number;
};

/** 片头/片尾个性化;缺省字段走渲染器内置默认,与不写 branding 等价。 */
export type Branding = {
  /** 片尾谢幕语;缺省 "Thanks for watching :)";空串 "" 隐藏文案 */
  outro_text?: string;
  /** 素材文件夹内的签名 SVG 相对路径;缺省用内置签名 */
  signature?: string;
  /** 片头总开关;false 时跳过片头(plan 同步不预留时长) */
  intro?: boolean;
};

export type TrimDecision = {
  mode: 'auto' | 'full' | 'seconds';
  applied: boolean;
  full_duration: number;
  trimmed_duration: number;
};

export type TimelineMeta = {
  version: number;
  audio: string;
  duration: number; // seconds
  width: number;
  height: number;
  fps: number;
  background: string;
  photo_scale: number;
  trim?: TrimDecision;
  input_hash?: string;
  plan_checksum?: string;
  branding?: Branding;
  /** 渲染时覆盖注入的照片签名落款开关;缺省 false */
  sign?: boolean;
  /** 渲染时覆盖注入的全局滤镜;逐张覆盖见 PhotoClip.filter(阶段二实现) */
  filter?: {id: string; intensity?: number} | null;
  chapters?: {enabled: boolean; day_count: number; card_count: number};
};

export type Timeline = {
  meta: TimelineMeta;
  photos: VisualClip[];
  subtitles: SubtitleLine[];
  beats?: {
    bpm: number;
    downbeats: number[];
  };
};
