/**
 * 标识:三枚照片方框呈对角线缀连,前面的一枚遮住后面的一枚 —— 「綴」的字面意思。
 *
 * 两个刻意的克制:
 * 1. 不画"穿针引线"的线条。24px 下方框加细线必然糊成一团,叠压关系本身已经表达了
 *    "缀连",多一条线只是噪声。
 * 2. 描边用 currentColor、填充用 --color-background,深浅色主题都靠继承自动适配,
 *    不维护两套配色。填充不能省:省掉后三枚方框会互相透视,叠压关系就没了。
 */

interface MarkProps {
  size?: number;
}

export const Mark = ({size = 24}: MarkProps) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 32 32"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.6}
    aria-hidden="true"
    focusable="false"
  >
    {/* 由后往前画,后画的自然盖住先画的 */}
    <rect x="17" y="3.5" width="11.5" height="11.5" rx="1.5" fill="var(--color-background)" />
    <rect x="10.25" y="10.25" width="11.5" height="11.5" rx="1.5" fill="var(--color-background)" />
    <rect x="3.5" y="17" width="11.5" height="11.5" rx="1.5" fill="var(--color-background)" />
  </svg>
);

interface LogoProps {
  size?: number;
  /** 大号用在欢迎页,小号用在顶栏 */
  variant?: 'compact' | 'hero';
}

export const Logo = ({size = 24, variant = 'compact'}: LogoProps) => (
  <span className={variant === 'hero' ? 'logo logo-hero' : 'logo'}>
    <Mark size={size} />
    <span className="logo-word">tsuzuri</span>
    {variant === 'hero' && <span className="logo-kana">綴り</span>}
  </span>
);
