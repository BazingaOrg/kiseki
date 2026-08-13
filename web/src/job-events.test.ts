import assert from 'node:assert/strict';
import test from 'node:test';

import {collapseJobEvents, formatElapsedClock, formatJobDuration} from './job-events.ts';
import type {JobEvent} from './useJob.ts';

test('start+success same stage collapses to one success row with durationMs', () => {
  const events: JobEvent[] = [
    {kind: 'start', text: '分析音频', stage: '分析音频'},
    {kind: 'success', text: '分析音频', stage: '分析音频', durationMs: 4200},
  ];
  assert.deepEqual(collapseJobEvents(events), [
    {key: 'stage:分析音频', label: '分析音频', state: 'success', durationMs: 4200, path: undefined},
  ]);
});

test('start only becomes one running row', () => {
  const events: JobEvent[] = [{kind: 'start', text: '规划照片时间线', stage: '规划照片时间线'}];
  assert.deepEqual(collapseJobEvents(events), [
    {key: 'stage:规划照片时间线', label: '规划照片时间线', state: 'running'},
  ]);
});

test('info/detail without stage are not folded', () => {
  const events: JobEvent[] = [
    {kind: 'start', text: '渲染视频', stage: '渲染视频'},
    {kind: 'info', text: '使用模板 slow-cinema'},
    {kind: 'detail', text: 'concurrency 4'},
    {kind: 'success', text: '渲染视频', stage: '渲染视频', durationMs: 1200},
  ];
  assert.deepEqual(collapseJobEvents(events), [
    {key: 'stage:渲染视频', label: '渲染视频', state: 'success', durationMs: 1200, path: undefined},
    {key: 'event:1', label: '信息', state: 'info', text: '使用模板 slow-cinema', path: undefined},
    {key: 'event:2', label: '详情', state: 'detail', text: 'concurrency 4', path: undefined},
  ]);
});

test('progress events are ignored by collapse', () => {
  const events: JobEvent[] = [
    {kind: 'start', text: '渲染视频', stage: '渲染视频'},
    {kind: 'progress', label: 'Encoding video', percent: 40},
  ];
  assert.deepEqual(collapseJobEvents(events), [
    {key: 'stage:渲染视频', label: '渲染视频', state: 'running'},
  ]);
});

test('formatJobDuration matches CLI formatDuration', () => {
  assert.equal(formatJobDuration(4200), '4.2s');
  assert.equal(formatJobDuration(65000), '1:05');
});

test('formatElapsedClock uses m:ss from zero', () => {
  assert.equal(formatElapsedClock(5000), '0:05');
  assert.equal(formatElapsedClock(65000), '1:05');
});
