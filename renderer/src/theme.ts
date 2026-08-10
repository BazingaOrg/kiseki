/** 视觉规格以 1080p 的短边为基准,避免竖版按长边放大。 */
export const getVisualScale = (width: number, height: number): number => Math.min(width, height) / 1080;

export const getExifLayout = (width: number, height: number) => {
  const stacked = height > width;
  return stacked
    ? {stacked, photoMaxWidth: width * 0.84, photoMaxHeight: height * 0.56, panelWidth: width * 0.84, gap: Math.min(width, height) * 0.06}
    : {stacked, photoMaxWidth: width * STILL.withExif.photoMaxWidth, photoMaxHeight: height * STILL.withExif.photoMaxHeight, panelWidth: width * STILL.withExif.panelWidth, gap: width * STILL.withExif.gap};
};

export const CANVAS = {
  width: 1920,
  height: 1080,
  fps: 60,
  background: '#FFFFFF',
} as const;

export const PALETTES = {
  light: {
    text: '#37332D',
    secondaryText: '#B0AEA6',
    divider: '#E4E2DC',
    photoOutline: 'rgba(16, 20, 26, 0.10)',
    photoShadowLayers: [
      {x: 0, y: 3, blur: 8, spread: -1, color: 'rgba(10, 12, 16, 0.32)'},
      {x: 0, y: 16, blur: 36, spread: -8, color: 'rgba(10, 12, 16, 0.28)'},
      {x: 0, y: 36, blur: 72, spread: -16, color: 'rgba(10, 12, 16, 0.18)'},
    ],
  },
  dark: {
    text: '#E8E5DE',
    secondaryText: '#807D76',
    divider: '#2A2925',
    photoOutline: 'rgba(232, 229, 222, 0.16)',
    photoShadowLayers: [
      {x: 0, y: 0, blur: 80, spread: -12, color: 'rgba(255, 252, 244, 0.06)'},
    ],
  },
} as const;

export type Palette = (typeof PALETTES)[keyof typeof PALETTES];

const getHexLuminance = (color: string): number | null => {
  const match = color.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!match) return null;
  const hex = match[1].length === 3
    ? [...match[1]].map((digit) => digit + digit).join('')
    : match[1];
  const channels = [0, 2, 4].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255);
  const linear = channels.map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
};

const contrastRatio = (a: number, b: number): number =>
  (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

const requireHexLuminance = (color: string, label: string): number => {
  const luminance = getHexLuminance(color);
  if (luminance === null) {
    throw new Error(`${label} 必须是 #RGB 或 #RRGGBB,收到 ${color}`);
  }
  return luminance;
};

const LIGHT_TEXT_LUMINANCE = requireHexLuminance(PALETTES.light.text, 'PALETTES.light.text');
const DARK_TEXT_LUMINANCE = requireHexLuminance(PALETTES.dark.text, 'PALETTES.dark.text');

/** Hex 背景选择主文字对比度更高的色板;非法 CSS 值保持旧版明色前景。 */
export const getPalette = (background: string): Palette => {
  const backgroundLuminance = getHexLuminance(background);
  if (backgroundLuminance === null) return PALETTES.light;
  const lightPaletteContrast = contrastRatio(backgroundLuminance, LIGHT_TEXT_LUMINANCE);
  const darkPaletteContrast = contrastRatio(backgroundLuminance, DARK_TEXT_LUMINANCE);
  return lightPaletteContrast >= darkPaletteContrast ? PALETTES.light : PALETTES.dark;
};

export const PHOTO = {
  outlineWidth: 1,
} as const;

export const getPhotoShadow = (scale: number, palette: Palette): string =>
  palette.photoShadowLayers
    .map(
      ({x, y, blur, spread, color}) =>
        `${x * scale}px ${y * scale}px ${blur * scale}px ${spread * scale}px ${color}`,
    )
    .join(', ');

export const SUBTITLE = {
  // 低干扰的摄影画展题签:纤细、小字号、缓入缓出,避免抢夺照片视觉焦点。
  fontSize: 36,
  fontWeight: 500,
  letterSpacing: '0.12em',
  letterSpacingCompact: '0.06em', // 单行超过约 18 个全角字符时回退
  compactThreshold: 18, // 全角字符等效数
  confidenceThreshold: 0.6, // Whisper 段置信度低于此值不渲染
  fadeInDuration: 0.35,
  fadeOutDuration: 0.25,
  riseDistance: 6,
  exitRise: 4,
} as const;

export const INFO_BAR = {
  // 可选右下角信息条(配置开关,默认关)
  fontSize: 20,
} as const;

export const ANIMATION = {
  audioFadeDuration: 1.5, // 秒;片尾音频淡出
  // 镜像见 analyzer/plan.py WHITE_FADE_DURATION——plan 据此为末张照片预留可见时长,
  // 改这里需要同步改那边
  whiteFadeDuration: 2.5, // 秒;片尾画面淡至画布色(比音频长,给谢幕语留可读时间)
} as const;

export const INTRO = {
  // 片头:画布上手写签名沿笔迹描边写出,再上墨填充,随后整卡淡出
  height: 120, // 签名字形高度(px,1080p 基准)
  opacity: 0.9,
  strokeWidth: 2.5, // viewBox 单位;书写阶段的笔迹粗细
  // drawDuration + inkDuration + hold + fadeOut 之和镜像见
  // analyzer/plan.py INTRO_DURATION——plan 据此把理想切换网格整体右移,
  // 四者任一变化都需要同步改那边的常量
  drawDuration: 1.4, // 秒;描边沿笔迹画出
  inkDuration: 0.35, // 秒;填充淡入(上墨)
  hold: 0.4, // 秒;写完停留
  fadeOut: 0.5, // 秒;整卡淡出
  // 镜像见 analyzer/plan.py MIN_PHOTO_VISIBLE
  minPhotoVisible: 0.8, // 秒;第一张照片在片头结束后至少可见时长,不足则跳过片头
} as const;

export const OUTRO = {
  // 片尾谢幕语:淡场过半后居中浮现,持续到最后一帧;沿用字幕的题签样式
  text: 'Thanks for watching :)',
  fontSize: 36,
  fontWeight: 500,
  letterSpacing: '0.12em',
  fontFamily: `'Noto Serif', serif`, // 与英文字幕同字体
  fadeRange: [0.5, 0.85] as const, // 随白场进度淡入的区间
  riseDistance: 6,
} as const;

/** 字族 × 语言路由:serif(展陈题签)与 sans(新闻/现代)两套,模板声明用哪套。 */
export const FONT_FAMILY = {
  serif: {
    ja: `'Noto Serif JP', 'Noto Serif SC', 'Noto Serif', serif`,
    zh: `'Noto Serif SC', 'Noto Serif JP', 'Noto Serif', serif`,
    en: `'Noto Serif', serif`,
    mixed: `'Noto Serif', 'Noto Serif JP', 'Noto Serif SC', serif`,
  },
  sans: {
    ja: `'Noto Sans JP', 'Noto Sans SC', 'Noto Sans', sans-serif`,
    zh: `'Noto Sans SC', 'Noto Sans JP', 'Noto Sans', sans-serif`,
    en: `'Noto Sans', sans-serif`,
    mixed: `'Noto Sans', 'Noto Sans JP', 'Noto Sans SC', sans-serif`,
  },
} as const;

export type FontFamily = keyof typeof FONT_FAMILY;

/** still 导出布局(1080p 基准比例;非 1080p 输出随画布自然缩放)。 */
export const STILL = {
  // 无 EXIF:与视频照片页一致,用 meta.photo_scale(默认 0.8)
  // 有 EXIF:展签布局——照片限位收紧,给右侧信息面板留位
  withExif: {
    photoMaxHeight: 0.72, // × 画布高
    photoMaxWidth: 0.52, // × 画布宽
    panelWidth: 0.24, // × 画布宽
    gap: 0.05, // × 画布宽
  },
  signature: {
    height: 56,
    panelHeight: 44,
    bottomInset: 26,
    opacity: 0.65,
    rightInset: 48, // 右下角落款距右边距(px,1080p 基准)
    maxWidthRatio: 0.26, // 落款最大宽度 = 画布宽度 × 该比例,保留印章/钤印比例
    subtitleGap: 24, // 落款与字幕的最小水平间距(px,1080p 基准)
  },
  typography: {
    // 参数行为视觉主角(字号同字幕 36);相机/镜头次之;时间最小用 INFO_BAR 灰
    paramsFontSize: 30,
    cameraFontSize: 28,
    lensFontSize: 24,
    datetimeFontSize: 20,
    lineGap: 10, // 行间距(px,1080p)
    groupGap: 28, // 相机组与参数组、参数组与时间之间
    paramsLineGap: 8,
    dividerWidth: 0.5,
    fontFamily: `'Noto Serif', 'Noto Serif JP', 'Noto Serif SC', serif`,
    letterSpacing: '0.12em',
  },
} as const;
