import {useState} from 'react';
import {Monitor, Moon, Sun} from 'lucide-react';

import {applyThemeMode, readThemeMode, writeThemeMode, type ThemeMode} from './theme';

const THEME_OPTIONS: {mode: ThemeMode; label: string; icon: typeof Monitor}[] = [
  {mode: 'system', label: '系统', icon: Monitor},
  {mode: 'light', label: '白天', icon: Sun},
  {mode: 'dark', label: '黑夜', icon: Moon},
];

export const ThemeToggle = () => {
  const [mode, setMode] = useState<ThemeMode>(() => readThemeMode());

  const choose = (next: ThemeMode) => {
    setMode(next);
    writeThemeMode(next);
    applyThemeMode(next, true);
  };

  return (
    <div className="theme-toggle" role="group" aria-label="主题模式">
      {THEME_OPTIONS.map(({mode: optionMode, label, icon: Icon}) => (
        <button
          key={optionMode}
          className={optionMode === mode ? 'theme-option theme-option-active' : 'theme-option'}
          type="button"
          aria-label={label}
          aria-pressed={optionMode === mode}
          title={label}
          onClick={() => choose(optionMode)}
        >
          <Icon size={15} strokeWidth={1.6} aria-hidden="true" />
        </button>
      ))}
    </div>
  );
};
