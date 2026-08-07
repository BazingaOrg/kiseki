import assert from 'node:assert/strict';
import test from 'node:test';

import {hashString, motionTransform, panDirection} from './motion.ts';

const motion = {type: 'kenburns' as const, zoom: 1.06, pan: 'center' as const};

test('panDirection maps fixed directions and center to zero', () => {
  assert.deepEqual(panDirection('center', 'a.jpg'), {x: 0, y: 0});
  assert.deepEqual(panDirection('left', 'a.jpg'), {x: -1, y: 0});
  assert.deepEqual(panDirection('right', 'a.jpg'), {x: 1, y: 0});
  assert.deepEqual(panDirection('up', 'a.jpg'), {x: 0, y: -1});
  assert.deepEqual(panDirection('down', 'a.jpg'), {x: 0, y: 1});
});

test('random pan is deterministic per src and always a cardinal direction', () => {
  const first = panDirection('random', 'trip/a.jpg');
  const second = panDirection('random', 'trip/a.jpg');
  assert.deepEqual(first, second, '同 src 必须得到同一方向,逐帧渲染可复现');
  assert.ok(Math.abs(first.x) + Math.abs(first.y) === 1, '必须是单一轴向');

  const other = panDirection('random', 'trip/b.jpg');
  for (const dir of [first, other]) {
    assert.ok([[-1, 0], [1, 0], [0, -1], [0, 1]].some(([x, y]) => dir.x === x && dir.y === y));
  }
});

test('hashString is stable and distributes', () => {
  assert.equal(hashString('a.jpg'), hashString('a.jpg'));
  assert.notEqual(hashString('a.jpg'), hashString('b.jpg'));
});

test('motionTransform is linear from rest to zoom over the clip', () => {
  const base = {motion, src: 'a.jpg', start: 2, end: 6, safeWidth: 1536, safeHeight: 864};
  assert.deepEqual(motionTransform({...base, t: 2}), {scale: 1, x: 0, y: 0}, '起点静止');
  assert.deepEqual(motionTransform({...base, t: 6}), {scale: 1.06, x: 0, y: 0}, '终点达到 zoom,center 不平移');
  const mid = motionTransform({...base, t: 4});
  assert.equal(mid.scale, 1.03);
  assert.equal(mid.x, 0);
  // 区间外钳制:不越过端点姿态
  assert.deepEqual(motionTransform({...base, t: 0}), {scale: 1, x: 0, y: 0});
  assert.deepEqual(motionTransform({...base, t: 99}), {scale: 1.06, x: 0, y: 0});
});

test('pan shifts toward the direction by (zoom-1) × half size at full progress', () => {
  const panned = motionTransform({
    motion: {...motion, pan: 'right'},
    src: 'a.jpg', t: 6, start: 2, end: 6, safeWidth: 1000, safeHeight: 500,
  });
  assert.equal(panned.scale, 1.06);
  assert.ok(Math.abs(panned.x - 30) < 1e-9, `向右平移半宽 × (zoom-1),实际 ${panned.x}`);
  assert.equal(panned.y, 0);
  const up = motionTransform({
    motion: {...motion, pan: 'up'},
    src: 'a.jpg', t: 6, start: 2, end: 6, safeWidth: 1000, safeHeight: 500,
  });
  assert.ok(Math.abs(up.y + 15) < 1e-9, `向上平移半高 × (zoom-1),实际 ${up.y}`);
  assert.equal(up.x, 0);
});

test('zoom below 1 is clamped to 1 (motion only pushes in)', () => {
  const result = motionTransform({
    motion: {type: 'kenburns', zoom: 0.8, pan: 'center'},
    src: 'a.jpg', t: 6, start: 2, end: 6, safeWidth: 1000, safeHeight: 500,
  });
  assert.equal(result.scale, 1);
});
