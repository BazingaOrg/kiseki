/**
 * 照片运镜(Ken Burns)纯函数。运镜是呈现层能力,由模板声明(见 templates.ts
 * 的 TemplateMotion),与 timeline 的 motion 字段无关 —— 后者已弃用,渲染器
 * 一律忽略。默认模板不带运镜,克制展陈风格保留。
 *
 * 所有计算必须确定性:Remotion 逐帧渲染,同输入永远同输出。
 */
import type {TemplateMotion} from './templates';

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

/** 稳定字符串哈希(djb2):同 src 永远得到同一方向,换渲染次数不漂移。 */
export const hashString = (input: string): number => {
  let hash = 5381;
  for (let i = 0; i < input.length; i += 1) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) >>> 0;
  }
  return hash;
};

export type PanVector = {x: number; y: number};

/** 平移方向向量;'random' 按照片 src 的稳定哈希确定性分配。 */
export const panDirection = (pan: TemplateMotion['pan'], src: string): PanVector => {
  switch (pan) {
    case 'center': return {x: 0, y: 0};
    case 'left': return {x: -1, y: 0};
    case 'right': return {x: 1, y: 0};
    case 'up': return {x: 0, y: -1};
    case 'down': return {x: 0, y: 1};
    case 'random': {
      const directions: PanVector[] = [
        {x: -1, y: 0},
        {x: 1, y: 0},
        {x: 0, y: -1},
        {x: 0, y: 1},
      ];
      return directions[hashString(src) % directions.length];
    }
  }
};

export interface MotionTransformInput {
  motion: TemplateMotion;
  src: string;
  /** 当前时间(秒) */
  t: number;
  /** 照片可见区间起点(秒) */
  start: number;
  /** 照片可见区间终点(秒) */
  end: number;
  safeWidth: number;
  safeHeight: number;
}

export interface MotionTransform {
  scale: number;
  x: number;
  y: number;
}

/**
 * 线性 Ken Burns:1 → zoom 缓慢推近,同时朝 pan 方向平移 (zoom-1)×半宽/半高。
 * progress 钳制在 [0,1],照片在区间外时保持端点姿态。
 */
export const motionTransform = ({motion, src, t, start, end, safeWidth, safeHeight}: MotionTransformInput): MotionTransform => {
  const progress = end > start ? clamp((t - start) / (end - start), 0, 1) : 0;
  const zoom = Math.max(1, motion.zoom);
  const scale = 1 + (zoom - 1) * progress;
  const {x, y} = panDirection(motion.pan, src);
  return {
    scale,
    x: x * (zoom - 1) * (safeWidth / 2) * progress,
    y: y * (zoom - 1) * (safeHeight / 2) * progress,
  };
};
