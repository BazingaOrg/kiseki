import {useCallback, useRef} from 'react';
import type {KeyboardEvent} from 'react';

export type TabKey = 'ArrowLeft' | 'ArrowRight' | 'Home' | 'End';

export const nextTabValue = <T extends string>(values: readonly T[], value: T, key: TabKey): T => {
  const current = Math.max(values.indexOf(value), 0);
  if (key === 'Home') return values[0]!;
  if (key === 'End') return values[values.length - 1]!;
  const offset = key === 'ArrowRight' ? 1 : -1;
  return values[(current + offset + values.length) % values.length]!;
};

interface UseTabsOptions<T extends string> {
  values: readonly T[];
  value: T;
  onValueChange: (value: T) => void;
  idPrefix: string;
}

/** A small controlled, horizontal tab primitive. It owns focus order, never selection state. */
export const useTabs = <T extends string>({values, value, onValueChange, idPrefix}: UseTabsOptions<T>) => {
  const tabs = useRef(new Map<T, HTMLButtonElement>());
  const tabId = (item: T) => `${idPrefix}-tab-${item}`;
  const panelId = (item: T) => `${idPrefix}-panel-${item}`;

  const select = useCallback((item: T, focus = false) => {
    onValueChange(item);
    if (focus) tabs.current.get(item)?.focus();
  }, [onValueChange]);

  const getTabProps = useCallback((item: T) => ({
    ref: (node: HTMLButtonElement | null) => {
      if (node) tabs.current.set(item, node);
      else tabs.current.delete(item);
    },
    id: tabId(item),
    role: 'tab' as const,
    tabIndex: value === item ? 0 : -1,
    'aria-selected': value === item,
    'aria-controls': panelId(item),
    onClick: () => select(item),
    onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' && event.key !== 'Home' && event.key !== 'End') return;
      event.preventDefault();
      select(nextTabValue(values, item, event.key), true);
    },
  }), [panelId, select, tabId, value, values]);

  const getPanelProps = useCallback((item: T) => ({
    id: panelId(item),
    role: 'tabpanel' as const,
    'aria-labelledby': tabId(item),
    hidden: value !== item,
  }), [panelId, tabId, value]);

  return {
    tabListProps: {role: 'tablist' as const, 'aria-orientation': 'horizontal' as const},
    getTabProps,
    getPanelProps,
  };
};
