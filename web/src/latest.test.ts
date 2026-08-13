/**
 * createLatestGate 的回归测试。
 * 跑法:node --experimental-strip-types --test src/latest.test.ts
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {createLatestGate, createSelectionEpoch} from './latest.ts';

test('单请求 begin 之后 isCurrent 为真', () => {
  const gate = createLatestGate();
  const ticket = gate.begin();
  assert.equal(gate.isCurrent(ticket), true);
});

test('两请求乱序回来,只有后发的那个通过', () => {
  const gate = createLatestGate();
  const first = gate.begin();
  const second = gate.begin();
  // 模拟 first 后回:它的 isCurrent 应为 false,second 应为 true
  assert.equal(gate.isCurrent(first), false);
  assert.equal(gate.isCurrent(second), true);
});

test('三连点只有最后一个通过', () => {
  const gate = createLatestGate();
  const first = gate.begin();
  const second = gate.begin();
  const third = gate.begin();
  assert.equal(gate.isCurrent(first), false);
  assert.equal(gate.isCurrent(second), false);
  assert.equal(gate.isCurrent(third), true);
});

test('同一 gate 被两类请求共享时,后发的使先发的作废(双向各一条)', () => {
  const gate = createLatestGate();
  // 面包屑点击(loadDirs)先发
  const dirsTicket = gate.begin();
  // 用户紧接着点了"就用这个文件夹"(handleSelectFolder)
  const selectTicket = gate.begin();
  assert.equal(gate.isCurrent(dirsTicket), false);
  assert.equal(gate.isCurrent(selectTicket), true);

  // 反过来:select 先发,dirs 后发
  const gate2 = createLatestGate();
  const selectTicket2 = gate2.begin();
  const dirsTicket2 = gate2.begin();
  assert.equal(gate2.isCurrent(selectTicket2), false);
  assert.equal(gate2.isCurrent(dirsTicket2), true);
});

test('未 begin 过的号码 0 不通过', () => {
  const gate = createLatestGate();
  assert.equal(gate.isCurrent(0), false);
  gate.begin();
  assert.equal(gate.isCurrent(0), false);
});

test('host selection 发生后，较早发出的 runtime 恢复响应失效', () => {
  const epoch = createSelectionEpoch();
  const runtimeRequest = epoch.capture();
  epoch.advance();
  assert.equal(epoch.isCurrent(runtimeRequest), false);
});

test('没有 host selection 时，runtime 恢复响应保持有效', () => {
  const epoch = createSelectionEpoch();
  assert.equal(epoch.isCurrent(epoch.capture()), true);
});
