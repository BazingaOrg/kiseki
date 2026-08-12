import type {CSSProperties} from 'react';

/**
 * 滤镜注册表:纯数据,仿 theme.ts 的 PALETTES 风格。
 * intensity 统一约定 0–1:0 = 恒等(不改变画面),1 = 滤镜设计强度上限。
 * 中间值线性插值;调用方(FramedPhoto)不解释具体滤镜实现,只消费 getFilter 的输出。
 */
export type FilterDef = {
  id: string;
  label: string;
  defaultIntensity: number;
  /** 返回可直接赋给 style.filter 的 CSS filter() 串;intensity=0 时应等价于恒等 */
  css?: (intensity: number) => string;
  /** 返回 SVG <filter> 元素的内部 markup(不含外层 <filter id="...">);id 由 getFilter 统一生成 */
  svg?: (intensity: number) => string;
  /** 叠加在照片上方的渲染层样式(暗角/漏光类);intensity=0 时应无可见效果 */
  overlay?: (intensity: number) => CSSProperties;
};

const clampIntensity = (intensity: number): number => Math.min(1, Math.max(0, intensity));

/** 0–1 区间内线性插值:from 对应 intensity=0,to 对应 intensity=1 */
const lerp = (from: number, to: number, intensity: number): number => from + (to - from) * intensity;

export const FILTERS: readonly FilterDef[] = [
  {
    id: 'faded',
    label: '褪色',
    defaultIntensity: 0.6,
    css: (intensity) =>
      `saturate(${lerp(1, 0.55, intensity)}) contrast(${lerp(1, 0.88, intensity)}) brightness(${lerp(1, 1.06, intensity)})`,
  },
  {
    id: 'warm',
    label: '暖阳',
    defaultIntensity: 0.6,
    css: (intensity) =>
      `sepia(${lerp(0, 0.35, intensity)}) saturate(${lerp(1, 1.15, intensity)}) hue-rotate(${lerp(0, -8, intensity)}deg) brightness(${lerp(1, 1.04, intensity)})`,
  },
  {
    id: 'cool',
    label: '冷调',
    defaultIntensity: 0.6,
    css: (intensity) =>
      `saturate(${lerp(1, 0.9, intensity)}) hue-rotate(${lerp(0, 12, intensity)}deg) brightness(${lerp(1, 1.02, intensity)})`,
  },
  {
    id: 'mono',
    label: '黑白',
    defaultIntensity: 1,
    css: (intensity) => `grayscale(${intensity}) contrast(${lerp(1, 1.06, intensity)})`,
  },
  {
    id: 'vintage',
    label: '怀旧',
    defaultIntensity: 0.6,
    css: (intensity) =>
      `sepia(${lerp(0, 0.5, intensity)}) contrast(${lerp(1, 0.92, intensity)}) brightness(${lerp(1, 1.05, intensity)}) saturate(${lerp(1, 0.85, intensity)})`,
  },
  {
    id: 'vignette',
    label: '暗角',
    defaultIntensity: 0.6,
    overlay: (intensity) => ({
      background: `radial-gradient(ellipse at center, rgba(0,0,0,0) ${lerp(75, 45, intensity)}%, rgba(0,0,0,${lerp(0, 0.45, intensity)}) 100%)`,
    }),
  },
  {
    id: 'teal-orange',
    label: '青橙',
    defaultIntensity: 0.6,
    // 分离色调:蓝通道抬暗部压高光(暗部偏青、高光偏橙),红通道抬中间调增暖,配合轻微提饱和
    css: (intensity) => `saturate(${1 + lerp(0, 0.25, intensity)})`,
    svg: (intensity) => {
      const shadowBlue = lerp(0, 0.16, intensity);
      const highlightBlue = lerp(1, 0.82, intensity);
      const midRed = 0.5 + lerp(0, 0.1, intensity);
      return `<feComponentTransfer>
        <feFuncR type="table" tableValues="0 ${midRed} 1" />
        <feFuncG type="table" tableValues="${shadowBlue / 2} 0.5 1" />
        <feFuncB type="table" tableValues="${shadowBlue} 0.5 ${highlightBlue}" />
      </feComponentTransfer>`;
    },
  },
  {
    id: 'riso',
    label: '孔版',
    defaultIntensity: 1,
    // duotone:先去色提对比,再按五段查表把灰阶映射到 墨蓝→青→橙→浅橙→纸白;intensity 控制与恒等的插值程度
    svg: (intensity) => {
      const stops = [
        [0.086, 0.255, 0.302], // #16414d 深墨蓝
        [0.169, 0.38, 0.447], // #2b6172 青
        [0.91, 0.463, 0.227], // #e8763a 橙
        [0.949, 0.69, 0.514], // #f2b083 浅橙
        [0.969, 0.945, 0.894], // #f7f1e4 纸白
      ];
      const identity = [0, 0.25, 0.5, 0.75, 1];
      const table = (channel: number): string =>
        identity.map((idv, i) => lerp(idv, stops[i][channel], intensity).toFixed(3)).join(' ');
      return `<feColorMatrix type="saturate" values="${lerp(1, 0, intensity).toFixed(3)}" />
      <feComponentTransfer>
        <feFuncR type="table" tableValues="${table(0)}" />
        <feFuncG type="table" tableValues="${table(1)}" />
        <feFuncB type="table" tableValues="${table(2)}" />
      </feComponentTransfer>`;
    },
    // 半调网点:两层错位 radial-gradient 点阵模拟斜向网点,multiply 压出油墨感
    overlay: (intensity) => {
      const size = 12;
      const dotAlpha = lerp(0, 0.28, intensity);
      const dot = `radial-gradient(circle, rgba(30,60,70,${dotAlpha}) 2.6px, transparent 3.4px)`;
      return {
        background: `${dot} 0 0/${size}px ${size}px, ${dot} ${size / 2}px ${size / 2}px/${size}px ${size}px`,
        mixBlendMode: 'multiply',
        opacity: lerp(0, 1, intensity),
      };
    },
  },
  {
    id: 'film',
    label: '胶片褪色',
    defaultIntensity: 0.6,
    // feComponentTransfer 压缩黑位、抬升灰位,模拟胶片褪色的低对比高灰雾感
    svg: (intensity) => {
      const black = lerp(0, 0.08, intensity);
      const white = lerp(1, 0.92, intensity);
      return `<feComponentTransfer>
        <feFuncR type="linear" slope="${white - black}" intercept="${black}" />
        <feFuncG type="linear" slope="${white - black}" intercept="${black}" />
        <feFuncB type="linear" slope="${white - black}" intercept="${black}" />
      </feComponentTransfer>`;
    },
  },
] as const;

export type FilterId = (typeof FILTERS)[number]['id'];

const FILTERS_BY_ID = new Map(FILTERS.map((filter) => [filter.id, filter]));

export const FILTER_IDS: readonly string[] = FILTERS.map((filter) => filter.id);

export const getFilterDef = (id: string): FilterDef | undefined => FILTERS_BY_ID.get(id);

export type ResolvedFilter = {
  imgStyle: CSSProperties;
  /** 完整 <filter id="..."> 元素 markup,无 svg 描述时为 null */
  svgDefMarkup: string | null;
  /** style.filter 中引用的 SVG filter id,与 svgDefMarkup 成对出现 */
  svgFilterId: string | null;
  /** 叠加层样式(暗角/漏光类),无 overlay 描述时为 null */
  overlayStyle: CSSProperties | null;
};

const IDENTITY: ResolvedFilter = {imgStyle: {}, svgDefMarkup: null, svgFilterId: null, overlayStyle: null};

/**
 * 按 id + intensity 解析出可直接消费的样式描述;未知 id 或无 filter(id 为空)时返回恒等结果,
 * 不抛错——渲染管线的非法 id 校验在 CLI 层(cli/options.mjs)完成,这里保持防御性 no-op。
 */
export const getFilter = (id: string | null | undefined, intensity?: number): ResolvedFilter => {
  if (!id) return IDENTITY;
  const def = getFilterDef(id);
  if (!def) return IDENTITY;
  const resolvedIntensity = clampIntensity(intensity ?? def.defaultIntensity);

  const cssParts: string[] = [];
  if (def.css) cssParts.push(def.css(resolvedIntensity));

  let svgDefMarkup: string | null = null;
  let svgFilterId: string | null = null;
  if (def.svg) {
    // intensity 编入 id:逐张滤镜下同一滤镜不同 intensity 会同时挂载多个 <filter> 定义,
    // 不带 intensity 指纹会共享 id 互相覆盖(见阶段二 Review 记录)
    svgFilterId = `kiseki-filter-${def.id}-${Math.round(resolvedIntensity * 100)}`;
    svgDefMarkup = `<filter id="${svgFilterId}">${def.svg(resolvedIntensity)}</filter>`;
    cssParts.push(`url(#${svgFilterId})`);
  }

  return {
    imgStyle: cssParts.length > 0 ? {filter: cssParts.join(' ')} : {},
    svgDefMarkup,
    svgFilterId,
    overlayStyle: def.overlay ? def.overlay(resolvedIntensity) : null,
  };
};
