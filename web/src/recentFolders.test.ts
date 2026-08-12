import assert from 'node:assert/strict';
import test from 'node:test';

import {loadRecentFolders, rememberFolder} from './recentFolders.ts';

const installStorage = (initial: Record<string, string> = {}) => {
  const values = new Map(Object.entries(initial));
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
  return () => { delete (globalThis as Record<string, unknown>).localStorage; };
};

test('recent folders keep the latest unique five entries', () => {
  const cleanup = installStorage();
  try {
    for (let index = 0; index < 6; index += 1) {
      rememberFolder({name: `folder-${index}`, path: `/folder-${index}`});
    }
    rememberFolder({name: 'renamed', path: '/folder-3'});
    assert.deepEqual(loadRecentFolders(), [
      {name: 'renamed', path: '/folder-3'},
      {name: 'folder-5', path: '/folder-5'},
      {name: 'folder-4', path: '/folder-4'},
      {name: 'folder-2', path: '/folder-2'},
      {name: 'folder-1', path: '/folder-1'},
    ]);
  } finally {
    cleanup();
  }
});

test('invalid stored recent folders fail closed', () => {
  const cleanup = installStorage({'kiseki:recent-folders': '{broken'});
  try {
    assert.deepEqual(loadRecentFolders(), []);
  } finally {
    cleanup();
  }
});
