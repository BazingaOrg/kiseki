interface MarkProps {
  size?: number;
}

export const Mark = ({size = 24}: MarkProps) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 32 32"
    fill="none"
    aria-hidden="true"
    focusable="false"
  >
    <rect x="2" y="2" width="28" height="28" rx="7" fill="#33271F" />
    <path
      d="M6.5 21H9.5C11.2 21 12.2 20.3 12.8 18.8L14.6 13L17.1 22.5L19.8 17.2L22 19.1L25.5 16"
      stroke="#FAF6EC"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <circle cx="25.5" cy="16" r="2.1" fill="#E2B667" />
  </svg>
);

interface LogoProps {
  size?: number;
  variant?: 'compact' | 'hero';
}

export const Logo = ({size = 24, variant = 'compact'}: LogoProps) => (
  <span className={variant === 'hero' ? 'logo logo-hero' : 'logo'}>
    <Mark size={size} />
    <span className="logo-word">kiseki</span>
    {variant === 'hero' && <span className="logo-kanji">軌跡</span>}
  </span>
);
