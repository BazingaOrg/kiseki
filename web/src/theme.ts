export type ThemeMode = 'system' | 'light' | 'dark';

export const THEME_MODE_KEY = 'kiseki-theme-mode';

export const normalizeThemeMode = (value: string | null): ThemeMode =>
  value === 'light' || value === 'dark' ? value : 'system';

export const readThemeMode = (): ThemeMode => {
  try {
    return normalizeThemeMode(localStorage.getItem(THEME_MODE_KEY));
  } catch {
    return 'system';
  }
};

export const writeThemeMode = (mode: ThemeMode) => {
  try {
    localStorage.setItem(THEME_MODE_KEY, mode);
  } catch {}
};

let transitionTimer: number | null = null;

export const applyThemeMode = (mode: ThemeMode, animate = false) => {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.dataset.theme = mode;
  if (transitionTimer !== null && typeof window !== 'undefined') window.clearTimeout(transitionTimer);
  if (!animate || typeof window === 'undefined') {
    delete root.dataset.themeTransition;
    return;
  }
  root.dataset.themeTransition = 'true';
  transitionTimer = window.setTimeout(() => {
    delete root.dataset.themeTransition;
    transitionTimer = null;
  }, 240);
};
