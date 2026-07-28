import assert from 'node:assert/strict';
import test from 'node:test';

import {freezeExecutorTree, resumeFrozenExecutorTree, signalExecutorGroupOrRoot, signalExecutorTree} from './runtime-lifecycle.mjs';

test('verified executor signals its process group, with root fallback only when needed', () => {
  const signals = [];
  assert.equal(signalExecutorGroupOrRoot({pid: 100, start: 'root'}, 'SIGTERM', {
    liveness: () => 'alive',
    killImpl: (pid, signal) => {
      signals.push([pid, signal]);
      if (pid < 0) throw new Error('group gone');
    },
  }), true);
  assert.deepEqual(signals, [[-100, 'SIGTERM'], [100, 'SIGTERM']]);
});

test('dead root does not suppress TERM/KILL for matching live descendants', () => {
  const root = {pid: 100, start: 'root'};
  const descendants = [{pid: 101, start: 'live'}, {pid: 102, start: 'old'}];
  const signals = [];
  const liveness = (identity) => identity.pid === 100 ? 'dead' : identity.start === 'live' ? 'alive' : 'dead';

  assert.equal(signalExecutorTree(root, descendants, 'SIGTERM', {
    liveness,
    killImpl: (pid, signal) => signals.push([pid, signal]),
  }), true);
  assert.equal(signalExecutorTree(root, descendants, 'SIGKILL', {
    liveness,
    killImpl: (pid, signal) => signals.push([pid, signal]),
  }), true);
  assert.deepEqual(signals, [[101, 'SIGTERM'], [101, 'SIGKILL']]);
});

test('unknown root identity fails closed without signalling descendants', () => {
  const signals = [];
  assert.equal(signalExecutorTree({pid: 100, start: 'root'}, [{pid: 101, start: 'child'}], 'SIGTERM', {
    liveness: () => 'unknown',
    killImpl: (pid, signal) => signals.push([pid, signal]),
  }), false);
  assert.deepEqual(signals, []);
});

test('freeze retains a stable identity union before TERM can reparent it', () => {
  const root = {pid: 100, start: 'root'};
  const child = {pid: 101, start: 'child'};
  const lateChild = {pid: 102, start: 'late'};
  const snapshots = [
    {known: true, descendants: [child]},
    {known: true, descendants: [child, lateChild]},
    {known: true, descendants: [child, lateChild]},
    {known: true, descendants: [child, lateChild]},
  ];
  const signals = [];
  const frozen = freezeExecutorTree(root, {
    liveness: () => 'alive',
    snapshot: () => snapshots.shift(),
    killImpl: (pid, signal) => signals.push([pid, signal]),
  });

  assert.equal(frozen.confirmed, true);
  assert.deepEqual(frozen.descendants, [child, lateChild]);
  assert.deepEqual(signals, [[-100, 'SIGSTOP'], [101, 'SIGSTOP'], [102, 'SIGSTOP']]);
  resumeFrozenExecutorTree(root, frozen.frozen, {
    liveness: () => 'alive',
    killImpl: (pid, signal) => signals.push([pid, signal]),
  });
  assert.deepEqual(signals.slice(3), [[-100, 'SIGCONT'], [100, 'SIGCONT'], [101, 'SIGCONT'], [102, 'SIGCONT']]);
});

test('freeze failure resumes every object it may have stopped', () => {
  const root = {pid: 100, start: 'root'};
  const child = {pid: 101, start: 'child'};
  const signals = [];
  const frozen = freezeExecutorTree(root, {
    liveness: (identity) => identity.pid === 101 ? 'unknown' : 'alive',
    snapshot: () => ({known: true, descendants: [child]}),
    killImpl: (pid, signal) => signals.push([pid, signal]),
  });

  assert.equal(frozen.confirmed, false);
  resumeFrozenExecutorTree(root, frozen.frozen, {
    liveness: () => 'alive',
    killImpl: (pid, signal) => signals.push([pid, signal]),
  });
  assert.deepEqual(signals, [[-100, 'SIGSTOP'], [-100, 'SIGCONT'], [100, 'SIGCONT']]);
});
