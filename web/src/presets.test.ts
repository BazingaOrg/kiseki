import assert from 'node:assert/strict';
import test from 'node:test';

import {deletePreset, loadPresets, savePreset} from './presets.ts';

const fakeStorage = () => {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => { map.set(key, value); },
    removeItem: (key: string) => { map.delete(key); },
  };
};

const installFakeStorage = () => {
  const storage = fakeStorage();
  (globalThis as Record<string, unknown>).localStorage = storage;
  return () => { delete (globalThis as Record<string, unknown>).localStorage; };
};

const baseOptions = {exif: false, sign: false, dark: true, format: 'portrait' as const, filter: 'vintage', filterIntensity: 0.8, template: 'slow-cinema'};

test('presets round-trip and overwrite by name', () => {
  const uninstall = installFakeStorage();
  try {
    assert.deepEqual(loadPresets('/album'), []);
    const first = savePreset('/album', '复古暗夜', {...baseOptions, template: 'slow-cinema'}, ['slow-cinema']);
    assert.equal(first.length, 1);
    assert.equal(first[0].name, '复古暗夜');
    assert.equal(first[0].options.template, 'slow-cinema');
    assert.deepEqual(loadPresets('/album'), first);

    // 同名覆盖,不重复
    const second = savePreset('/album', '复古暗夜', {...baseOptions, dark: false}, ['slow-cinema']);
    assert.equal(second.length, 1);
    assert.equal(second[0].options.dark, false);

    // 不同素材夹互不影响
    assert.deepEqual(loadPresets('/other'), []);
  } finally {
    uninstall();
  }
});

test('saving sanitizes unknown template ids so renders cannot fail validation', () => {
  const uninstall = installFakeStorage();
  try {
    const saved = savePreset('/album', '旧模板', {...baseOptions, template: 'gone'}, ['slow-cinema']);
    assert.equal(saved[0].options.template, null);
  } finally {
    uninstall();
  }
});

test('corrupt or malformed preset data reads as empty and deleting is safe', () => {
  const uninstall = installFakeStorage();
  try {
    const storage = (globalThis as Record<string, unknown>).localStorage as ReturnType<typeof fakeStorage>;
    storage.setItem('kiseki-presets:/album', '{not json');
    assert.deepEqual(loadPresets('/album'), []);

    storage.setItem('kiseki-presets:/album', JSON.stringify([{id: 'x', name: 'ok', options: {}}, 'junk', null]));
    const loaded = loadPresets('/album');
    assert.equal(loaded.length, 1);
    assert.equal(loaded[0].name, 'ok');

    assert.equal(deletePreset('/album', 'missing').length, 1, '不存在的 id 不删');
    assert.deepEqual(deletePreset('/album', 'x'), []);
  } finally {
    uninstall();
  }
});
