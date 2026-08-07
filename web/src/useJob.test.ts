import assert from 'node:assert/strict';
import test from 'node:test';

import {clearLastJobRecord, readLastJobRecord, writeLastJobRecord} from './lastJob.ts';

/** 假 localStorage:node 测试环境没有 DOM,注入全局即可满足 typeof 守卫。 */
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

test('last job record round-trips through localStorage', () => {
  const uninstall = installFakeStorage();
  try {
    assert.equal(readLastJobRecord(), null, '无记录时读 null');
    writeLastJobRecord({id: 'job-1', kind: 'render', folder: '/album', at: 123});
    assert.deepEqual(readLastJobRecord(), {id: 'job-1', kind: 'render', folder: '/album', at: 123});
    clearLastJobRecord();
    assert.equal(readLastJobRecord(), null, '清除后读 null');
  } finally {
    uninstall();
  }
});

test('corrupt or non-object records read as null', () => {
  const uninstall = installFakeStorage();
  try {
    const storage = (globalThis as Record<string, unknown>).localStorage as ReturnType<typeof fakeStorage>;
    storage.setItem('tsuzuri-last-job', '{not json');
    assert.equal(readLastJobRecord(), null, '损坏 JSON 读 null');
    storage.setItem('tsuzuri-last-job', JSON.stringify({noId: true}));
    assert.equal(readLastJobRecord(), null, '缺 id 字段读 null');
  } finally {
    uninstall();
  }
});
