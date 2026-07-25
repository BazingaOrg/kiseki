import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import test from 'node:test';

import {buildJobArgv, createJobManager, JobValidationError} from './jobs.mjs';

// ---- buildJobArgv --------------------------------------------------------

test('render: default options → 只有 folder,不带任何 flag', () => {
  const argv = buildJobArgv({kind: 'render', folder: '/abs/trip'});
  assert.deepEqual(argv, ['/abs/trip']);
});

test('render: exif/sign/dark 组合', () => {
  const argv = buildJobArgv({kind: 'render', folder: '/abs/trip', options: {exif: true, sign: true, dark: true}});
  assert.deepEqual(argv, ['/abs/trip', '--exif', '--sign', '--dark']);
});

test('render: format 三态', () => {
  assert.deepEqual(buildJobArgv({kind: 'render', folder: '/f', options: {format: 'landscape'}}), ['/f']);
  assert.deepEqual(buildJobArgv({kind: 'render', folder: '/f', options: {format: 'portrait'}}), ['/f', '--portrait']);
  assert.deepEqual(buildJobArgv({kind: 'render', folder: '/f', options: {format: 'square'}}), ['/f', '--square']);
});

test('render: filter + filterIntensity', () => {
  const argv = buildJobArgv({kind: 'render', folder: '/f', options: {filter: 'warm', filterIntensity: 0.5}});
  assert.deepEqual(argv, ['/f', '--filter', 'warm', '--filter-intensity', '0.5']);
});

test('render: draft + trim', () => {
  const argv = buildJobArgv({kind: 'render', folder: '/f', options: {draft: true, trim: 'auto'}});
  assert.deepEqual(argv, ['/f', '--draft', '--trim', 'auto']);
});

test('render: trim full', () => {
  const argv = buildJobArgv({kind: 'render', folder: '/f', options: {trim: 'full'}});
  assert.deepEqual(argv, ['/f', '--trim', 'full']);
});

test('render: scale 被忽略(仅 still 生效)', () => {
  const argv = buildJobArgv({kind: 'render', folder: '/f', options: {scale: 4}});
  assert.deepEqual(argv, ['/f']);
});

test('still: 默认 scale=2', () => {
  const argv = buildJobArgv({kind: 'still', folder: '/f'});
  assert.deepEqual(argv, ['still', '/f', '--scale', '2']);
});

test('still: 各选项组合 + 自定义 scale', () => {
  const argv = buildJobArgv({
    kind: 'still',
    folder: '/f',
    options: {exif: true, sign: true, dark: true, format: 'square', filter: 'mono', filterIntensity: 1, scale: 4},
  });
  assert.deepEqual(argv, [
    'still',
    '/f',
    '--exif',
    '--sign',
    '--dark',
    '--square',
    '--filter',
    'mono',
    '--filter-intensity',
    '1',
    '--scale',
    '4',
  ]);
});

test('still: draft/trim 被忽略(仅 render 生效)', () => {
  const argv = buildJobArgv({kind: 'still', folder: '/f', options: {draft: true, trim: 'auto'}});
  assert.deepEqual(argv, ['still', '/f', '--scale', '2']);
});

test('未知 kind 抛 JobValidationError', () => {
  assert.throws(() => buildJobArgv({kind: 'bogus', folder: '/f'}), (error) => {
    assert.ok(error instanceof JobValidationError);
    assert.equal(error.field, 'kind');
    return true;
  });
});

test('非法 format 抛错,field 为 format', () => {
  assert.throws(() => buildJobArgv({kind: 'render', folder: '/f', options: {format: 'diamond'}}), (error) => {
    assert.ok(error instanceof JobValidationError);
    assert.equal(error.field, 'format');
    return true;
  });
});

test('非法 filter 抛错,field 为 filter', () => {
  assert.throws(() => buildJobArgv({kind: 'render', folder: '/f', options: {filter: 'nope'}}), (error) => {
    assert.equal(error.field, 'filter');
    return true;
  });
});

test('filterIntensity 超出 0-1 抛错', () => {
  assert.throws(
    () => buildJobArgv({kind: 'render', folder: '/f', options: {filter: 'warm', filterIntensity: 1.5}}),
    (error) => {
      assert.equal(error.field, 'filterIntensity');
      return true;
    },
  );
});

test('给了 filterIntensity 但没给 filter 抛错', () => {
  assert.throws(() => buildJobArgv({kind: 'render', folder: '/f', options: {filterIntensity: 0.5}}), (error) => {
    assert.equal(error.field, 'filterIntensity');
    return true;
  });
});

test('非法 trim 抛错(数字秒数在这个契约里不支持)', () => {
  assert.throws(() => buildJobArgv({kind: 'render', folder: '/f', options: {trim: '5'}}), (error) => {
    assert.equal(error.field, 'trim');
    return true;
  });
});

test('scale 超出 1-4 抛错', () => {
  assert.throws(() => buildJobArgv({kind: 'still', folder: '/f', options: {scale: 5}}), (error) => {
    assert.equal(error.field, 'scale');
    return true;
  });
});

test('scale 非整数抛错', () => {
  assert.throws(() => buildJobArgv({kind: 'still', folder: '/f', options: {scale: 2.5}}), (error) => {
    assert.equal(error.field, 'scale');
    return true;
  });
});

test('非 boolean 的 exif 抛错', () => {
  assert.throws(() => buildJobArgv({kind: 'render', folder: '/f', options: {exif: 'yes'}}), (error) => {
    assert.equal(error.field, 'exif');
    return true;
  });
});

test('未知 options 字段被忽略', () => {
  const argv = buildJobArgv({kind: 'render', folder: '/f', options: {mystery: 'field'}});
  assert.deepEqual(argv, ['/f']);
});

// ---- createJobManager -----------------------------------------------------

/** 造一个假的 child_process.ChildProcess,足够 jobs.mjs 使用的接口都给到。 */
const makeFakeChild = () => {
  const child = new EventEmitter();
  child.pid = 12345;
  const fd3 = new PassThrough();
  child.stdio = [null, new PassThrough(), new PassThrough(), fd3];
  child.kill = () => {};
  return child;
};

const writeNdjson = (fd3, events) => {
  for (const event of events) fd3.write(JSON.stringify(event) + '\n');
};

test('并发限制:第二个 createJob 返回 busy', () => {
  const children = [];
  const spawnImpl = () => {
    const child = makeFakeChild();
    children.push(child);
    return child;
  };
  const manager = createJobManager({spawnImpl});
  const first = manager.createJob({kind: 'render', folder: '/f'});
  assert.ok(first.id);
  const second = manager.createJob({kind: 'render', folder: '/f'});
  assert.deepEqual(second, {error: 'busy'});
});

test('任务完成后 getJob 反映 done/failed 与 exitCode', async () => {
  let child;
  const spawnImpl = () => {
    child = makeFakeChild();
    return child;
  };
  const manager = createJobManager({spawnImpl});
  const {id} = manager.createJob({kind: 'render', folder: '/f'});

  writeNdjson(child.stdio[3], [{kind: 'start', text: '开始'}]);
  await new Promise((resolve) => setImmediate(resolve));
  child.emit('exit', 0);
  await new Promise((resolve) => setImmediate(resolve));

  const job = manager.getJob(id);
  assert.equal(job.status, 'done');
  assert.equal(job.exitCode, 0);
  assert.deepEqual(job.events, [{kind: 'start', text: '开始'}]);
});

test('非零退出码 → status failed', async () => {
  let child;
  const spawnImpl = () => {
    child = makeFakeChild();
    return child;
  };
  const manager = createJobManager({spawnImpl});
  const {id} = manager.createJob({kind: 'render', folder: '/f'});
  child.emit('exit', 1);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(manager.getJob(id).status, 'failed');
  assert.equal(manager.getJob(id).exitCode, 1);
});

test('不存在的 job → getJob 返回 null', () => {
  const manager = createJobManager({spawnImpl: makeFakeChild});
  assert.equal(manager.getJob('nope'), null);
});

test('cancelJob:调用 killImpl(-pid, SIGTERM),退出后 status 为 cancelled', async () => {
  let child;
  const spawnImpl = () => {
    child = makeFakeChild();
    return child;
  };
  const killCalls = [];
  const killImpl = (pid, signal) => killCalls.push([pid, signal]);
  const manager = createJobManager({spawnImpl, killImpl});
  const {id} = manager.createJob({kind: 'render', folder: '/f'});

  const ok = manager.cancelJob(id);
  assert.equal(ok, true);
  assert.deepEqual(killCalls, [[-12345, 'SIGTERM']]);

  child.emit('exit', null);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(manager.getJob(id).status, 'cancelled');
});

test('cancelJob:job 不存在返回 false', () => {
  const manager = createJobManager({spawnImpl: makeFakeChild});
  assert.equal(manager.cancelJob('nope'), false);
});

test('cancelJob:job 已结束返回 false', async () => {
  let child;
  const spawnImpl = () => {
    child = makeFakeChild();
    return child;
  };
  const manager = createJobManager({spawnImpl});
  const {id} = manager.createJob({kind: 'render', folder: '/f'});
  child.emit('exit', 0);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(manager.cancelJob(id), false);
});

test('subscribeEvents:订阅后收到历史事件,再收到新事件与 end 帧', async () => {
  let child;
  const spawnImpl = () => {
    child = makeFakeChild();
    return child;
  };
  const manager = createJobManager({spawnImpl});
  const {id} = manager.createJob({kind: 'render', folder: '/f'});

  writeNdjson(child.stdio[3], [{kind: 'start', text: 'a'}]);
  await new Promise((resolve) => setImmediate(resolve));

  const chunks = [];
  const unsubscribe = manager.subscribeEvents(id, (chunk) => chunks.push(chunk));
  assert.equal(chunks.length, 1);
  assert.match(chunks[0], /"text":"a"/);

  writeNdjson(child.stdio[3], [{kind: 'progress', label: 'x', percent: 50}]);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(chunks.length, 2);

  child.emit('exit', 0);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(chunks.length, 3);
  assert.match(chunks[2], /^event: end\n/);

  unsubscribe();
});

test('subscribeEvents:job 不存在返回 null', () => {
  const manager = createJobManager({spawnImpl: makeFakeChild});
  assert.equal(manager.subscribeEvents('nope', () => {}), null);
});

test('subscribeEvents:job 已结束时立即补发 end 帧', async () => {
  let child;
  const spawnImpl = () => {
    child = makeFakeChild();
    return child;
  };
  const manager = createJobManager({spawnImpl});
  const {id} = manager.createJob({kind: 'render', folder: '/f'});
  child.emit('exit', 0);
  await new Promise((resolve) => setImmediate(resolve));

  const chunks = [];
  manager.subscribeEvents(id, (chunk) => chunks.push(chunk));
  assert.ok(chunks.some((chunk) => chunk.startsWith('event: end\n')));
});

test('unsubscribe 后监听者计数归零(防内存泄漏)', async () => {
  let child;
  const spawnImpl = () => {
    child = makeFakeChild();
    return child;
  };
  const manager = createJobManager({spawnImpl});
  const {id} = manager.createJob({kind: 'render', folder: '/f'});

  const unsubscribe = manager.subscribeEvents(id, () => {});
  assert.equal(manager._debugListenerCount(id), 1);
  unsubscribe();
  assert.equal(manager._debugListenerCount(id), 0);

  child.emit('exit', 0);
});

test('fd3 解析失败的行被跳过,不影响后续事件', async () => {
  let child;
  const spawnImpl = () => {
    child = makeFakeChild();
    return child;
  };
  const manager = createJobManager({spawnImpl});
  const {id} = manager.createJob({kind: 'render', folder: '/f'});

  child.stdio[3].write('not json\n');
  child.stdio[3].write(JSON.stringify({kind: 'info', text: 'ok'}) + '\n');
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(manager.getJob(id).events, [{kind: 'info', text: 'ok'}]);
});

test('createJob 时选项非法直接抛 JobValidationError,不占用并发锁', () => {
  const manager = createJobManager({spawnImpl: makeFakeChild});
  assert.throws(() => manager.createJob({kind: 'render', folder: '/f', options: {format: 'bogus'}}), JobValidationError);
  // 校验失败不应该锁住"当前任务"位置,后续合法请求应该能正常创建。
  const result = manager.createJob({kind: 'render', folder: '/f'});
  assert.ok(result.id);
});

// --- 进程生命周期:取消兜底、spawn 失败、killAll ----------------------------

test('cancel escalates to SIGKILL when the child ignores SIGTERM', async () => {
  const child = makeFakeChild();
  const signals = [];
  const manager = createJobManager({
    spawnImpl: () => child,
    killImpl: (pid, signal) => signals.push([pid, signal]),
  });
  const {id} = manager.createJob({kind: 'still', folder: '/tmp/x', options: {}});
  manager.cancelJob(id);
  assert.deepEqual(signals, [[-12345, 'SIGTERM']]);

  // 子进程装死不退出 —— 没有兜底的话 runningJobId 永不释放,之后每个任务都 409
  await new Promise((resolve) => setTimeout(resolve, 8100));
  assert.deepEqual(signals[1], [-12345, 'SIGKILL']);
});

test('a child that exits in time is never SIGKILLed', async () => {
  const child = makeFakeChild();
  const signals = [];
  const manager = createJobManager({
    spawnImpl: () => child,
    killImpl: (pid, signal) => signals.push([pid, signal]),
  });
  const {id} = manager.createJob({kind: 'still', folder: '/tmp/x', options: {}});
  manager.cancelJob(id);
  child.emit('exit', null);
  await new Promise((resolve) => setTimeout(resolve, 8100));
  assert.equal(signals.length, 1, '按时退出的子进程不该再挨一刀');
  assert.equal(manager.getJob(id).status, 'cancelled');
});

test('a spawn failure releases the concurrency lock instead of wedging it', () => {
  const child = makeFakeChild();
  const manager = createJobManager({spawnImpl: () => child, killImpl: () => {}});
  const first = manager.createJob({kind: 'still', folder: '/tmp/x', options: {}});
  // spawn 失败时 ChildProcess 发 'error' 而不发 'exit',不处理就永远占着并发锁
  child.emit('error', new Error('EAGAIN'));
  assert.equal(manager.getJob(first.id).status, 'failed');
  const second = manager.createJob({kind: 'still', folder: '/tmp/x', options: {}});
  assert.ok(second.id, '第一个任务失败后应当能再起一个,而不是一直 409');
});

test('a spawn failure notifies subscribers with an end frame', () => {
  const child = makeFakeChild();
  const manager = createJobManager({spawnImpl: () => child, killImpl: () => {}});
  const {id} = manager.createJob({kind: 'still', folder: '/tmp/x', options: {}});
  const chunks = [];
  manager.subscribeEvents(id, (chunk) => chunks.push(chunk));
  child.emit('error', new Error('EMFILE'));
  assert.ok(chunks.some((chunk) => chunk.startsWith('event: end\n')), '订阅者不该干等一个永远不来的结束');
});

test('killAll signals every running job so Ctrl+C leaves no orphans', () => {
  const child = makeFakeChild();
  const signals = [];
  const manager = createJobManager({
    spawnImpl: () => child,
    killImpl: (pid, signal) => signals.push([pid, signal]),
  });
  manager.createJob({kind: 'render', folder: '/tmp/x', options: {}});
  manager.killAll();
  // detached 的子进程收不到终端的 SIGINT,不显式杀就会变成孤儿继续渲染
  assert.deepEqual(signals, [[-12345, 'SIGTERM']]);
});
