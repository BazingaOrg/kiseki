import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {PassThrough} from 'node:stream';
import test from 'node:test';

import {
  buildJobArgv,
  buildJobEnv,
  buildJobInvocation,
  buildJobSpec,
  createJobManager as createJobManagerActual,
  JobValidationError,
  listDescendants,
  parseYtDlpProgress,
} from './jobs.mjs';
import {JobValidationError as JobSpecValidationError} from './job-spec.mjs';
import {outputArtifactPaths} from '../atomic-output.mjs';

test('job-spec 与 jobs 复用同一个 JobValidationError 类身份', () => {
  assert.equal(JobSpecValidationError, JobValidationError);
});

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

test('web job argv normalizes a filter alias before it reaches the CLI', () => {
  const argv = buildJobArgv({kind: 'render', folder: '/f', options: {filter: 'tealorange', filterIntensity: 0.8}});
  assert.deepEqual(argv, ['/f', '--filter', 'teal-orange', '--filter-intensity', '0.8']);
});

test('render: draft + trim', () => {
  const argv = buildJobArgv({kind: 'render', folder: '/f', options: {draft: true, trim: 'auto'}});
  assert.deepEqual(argv, ['/f', '--draft', '--trim', 'auto']);
});

test('render: template 透传 --template;null 不带 flag', () => {
  assert.deepEqual(buildJobArgv({kind: 'render', folder: '/f', options: {template: 'slow-cinema'}}), ['/f', '--template', 'slow-cinema']);
  assert.deepEqual(buildJobArgv({kind: 'render', folder: '/f', options: {template: null}}), ['/f']);
});

test('render: 未知模板 id 校验报错', () => {
  assert.throws(() => buildJobArgv({kind: 'render', folder: '/f', options: {template: 'nope'}}), /template 必须是以下之一/);
});

test('render: trim full', () => {
  const argv = buildJobArgv({kind: 'render', folder: '/f', options: {trim: 'full'}});
  assert.deepEqual(argv, ['/f', '--trim', 'full']);
});

test('render: scale 被忽略(仅 still 生效)', () => {
  const argv = buildJobArgv({kind: 'render', folder: '/f', options: {scale: 4}});
  assert.deepEqual(argv, ['/f']);
});

test('still: 默认 scale=2,不出现在 argv 里', () => {
  const argv = buildJobArgv({kind: 'still', folder: '/f'});
  assert.deepEqual(argv, ['still', '/f']);
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
  assert.deepEqual(argv, ['still', '/f']);
});

test('still: scale 非默认值才出现在 argv 里', () => {
  for (const scale of [1, 3, 4]) {
    const argv = buildJobArgv({kind: 'still', folder: '/f', options: {scale}});
    assert.deepEqual(argv, ['still', '/f', '--scale', String(scale)]);
  }
  assert.deepEqual(buildJobArgv({kind: 'still', folder: '/f', options: {scale: 2}}), ['still', '/f']);
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

const TEST_EXECUTOR_START = 'Mon Jan  1 00:00:00 2024';
const activeFakePids = new Set();
const fakeLeaseRoots = new Set();
const testProcessTable = () => [...activeFakePids]
  .map((pid) => `${pid} 1 ${TEST_EXECUTOR_START}`)
  .join('\n');

/** 真实的 still 输入:buildJobSpec 会扫描素材目录,不能再靠不存在的 /tmp/x. */
const makeStillFixture = () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'tsuzuri-still-fixture-'));
  fs.writeFileSync(path.join(folder, 'photo.jpg'), 'fixture');
  return folder;
};
const STILL_FIXTURE = makeStillFixture();

test.after(() => {
  for (const root of fakeLeaseRoots) fs.rmSync(root, {recursive: true, force: true});
  fs.rmSync(STILL_FIXTURE, {recursive: true, force: true});
});

/** 造一个假的 child_process.ChildProcess,并建模 exit 后才会被 close/reap. */
const makeFakeChild = ({autoCloseOnExit = true, pid = 12345, stdioCount = 4} = {}) => {
  const child = new EventEmitter();
  child.pid = pid;
  if (Number.isInteger(pid) && pid > 0) activeFakePids.add(pid);
  child.stdio = [null, new PassThrough(), new PassThrough()];
  if (stdioCount > 3) child.stdio.push(new PassThrough());
  child.kill = () => {};
  const emit = child.emit.bind(child);
  child.emit = (event, ...args) => {
    const result = emit(event, ...args);
    if (event === 'exit' || event === 'close') {
      activeFakePids.delete(pid);
      if (autoCloseOnExit) emit('close', ...args);
    }
    return result;
  };
  return child;
};

const makeCanonicalLeaseManager = ({onRelease = () => {}} = {}) => {
  let nextId = 0;
  const transactions = new Map();
  const leaseRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tsuzuri-fake-lease-'));
  fakeLeaseRoots.add(leaseRoot);
  return {
    acquire: ({resources = []} = {}) => {
      const id = `fake-lease-${++nextId}`;
      const taskRoot = path.join(leaseRoot, id);
      fs.mkdirSync(taskRoot, {recursive: true});
      return {id, token: 'token', taskRoot, resources};
    },
    markSpawnIntent: () => {},
    registerExecutor: (_lease, executor) => ({pid: executor.pid, start: TEST_EXECUTOR_START}),
    extendOutputClaims: () => {},
    prepareOutputTransaction: (lease, entries) => transactions.set(lease.id, entries),
    setOutputTransactionPhase: () => {},
    rollbackOutputTransaction: (lease) => {
      for (const entry of transactions.get(lease.id) ?? []) {
        const {finalPath, partialPath, backupPath} = outputArtifactPaths(entry.finalPath, lease.id);
        if (fs.existsSync(backupPath)) {
          if (fs.existsSync(finalPath)) fs.rmSync(finalPath, {force: true});
          fs.renameSync(backupPath, finalPath);
        }
        fs.rmSync(partialPath, {force: true});
      }
      transactions.delete(lease.id);
    },
    finalizeOutputTransaction: (lease) => {
      for (const entry of transactions.get(lease.id) ?? []) {
        fs.rmSync(outputArtifactPaths(entry.finalPath, lease.id).backupPath, {force: true});
      }
      transactions.delete(lease.id);
    },
    release: (lease) => {
      onRelease(lease);
      fs.rmSync(lease.taskRoot, {recursive: true, force: true});
      return true;
    },
  };
};

const createJobManager = (deps = {}) => createJobManagerActual({
  leaseManager: makeCanonicalLeaseManager(),
  readProcessTable: testProcessTable,
  ...deps,
});

const assertGracefulTerminationSignals = (signals, pid) => {
  assert.deepEqual(signals, [
    [-pid, 'SIGSTOP'],
    [-pid, 'SIGTERM'],
    [pid, 'SIGTERM'],
    [-pid, 'SIGCONT'],
  ]);
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
  child.emit('close', 0);
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
  child.emit('close', 1);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(manager.getJob(id).status, 'failed');
  assert.equal(manager.getJob(id).exitCode, 1);
});

test('exit 后仍保持 running,直到 stdio close/reap 才发送唯一终态', () => {
  const child = makeFakeChild({autoCloseOnExit: false});
  const manager = createJobManager({spawnImpl: () => child});
  const {id} = manager.createJob({kind: 'render', folder: '/f'});
  const chunks = [];
  manager.subscribeEvents(id, (chunk) => chunks.push(chunk));

  child.emit('exit', 0);
  assert.equal(manager.getJob(id).status, 'running');
  assert.equal(chunks.filter((chunk) => chunk.startsWith('event: end\n')).length, 0);
  child.emit('close', 0);
  child.emit('close', 0);
  assert.equal(manager.getJob(id).status, 'done');
  assert.equal(chunks.filter((chunk) => chunk.startsWith('event: end\n')).length, 1);
});

test('cancel 进入 stopping;Windows 只使用 taskkill /T 路径', async () => {
  const child = makeFakeChild();
  const taskkillCalls = [];
  let alive = true;
  const manager = createJobManager({
    spawnImpl: () => child,
    platform: 'win32',
    leaseManager: makeCanonicalLeaseManager(),
    taskkillImpl: async (pid, force) => taskkillCalls.push([pid, force]),
    executorLivenessImpl: () => alive ? 'alive' : 'dead',
    forceKillAfterMs: 100,
  });
  const {id} = manager.createJob({kind: 'render', folder: '/f'});
  assert.equal(manager.cancelJob(id), true);
  assert.equal(manager.getJob(id).status, 'stopping');
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(taskkillCalls, [[12345, false]]);
  alive = false;
  child.emit('close', null);
  assert.equal(manager.getJob(id).status, 'cancelled');
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
  assertGracefulTerminationSignals(killCalls, 12345);

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
  // 校验失败不应该锁住"当前任务"位置,后续合法请求应该能正常创建.
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
  const {id} = manager.createJob({kind: 'still', folder: STILL_FIXTURE, options: {}});
  manager.cancelJob(id);
  assertGracefulTerminationSignals(signals, 12345);

  // 子进程装死不退出 —— 没有兜底的话 runningJobId 永不释放,之后每个任务都 409
  await new Promise((resolve) => setTimeout(resolve, 8100));
  assert.ok(signals.some(([pid, signal]) => pid === -12345 && signal === 'SIGKILL'));
});

test('取消后 child close 且未快照到后代时可直接完成,不补盲目的 SIGKILL', async () => {
  const child = makeFakeChild();
  const signals = [];
  const manager = createJobManager({
    spawnImpl: () => child,
    killImpl: (pid, signal) => signals.push([pid, signal]),
  });
  const {id} = manager.createJob({kind: 'still', folder: STILL_FIXTURE, options: {}});
  manager.cancelJob(id);
  child.emit('exit', null);
  assert.equal(manager.getJob(id).status, 'cancelled');
  await new Promise((resolve) => setTimeout(resolve, 3200));
  assertGracefulTerminationSignals(signals, 12345);
});

test('取消时 child close 不是终态:已快照后代仍存活则保留 lease 并等待/强杀', async () => {
  const child = makeFakeChild({autoCloseOnExit: false});
  const signals = [];
  const processTable = `12345 1 ${TEST_EXECUTOR_START}\n12346 12345 ${TEST_EXECUTOR_START}\n`;
  const manager = createJobManager({
    spawnImpl: () => child,
    killImpl: (pid, signal) => signals.push([pid, signal]),
    readProcessTable: () => processTable,
    forceKillAfterMs: 1,
  });
  const {id} = manager.createJob({kind: 'still', folder: STILL_FIXTURE, options: {}});
  manager.cancelJob(id);
  child.emit('exit', null);
  child.emit('close', null);
  assert.equal(manager.getJob(id).status, 'stopping');
  // pollTermination 每 50ms 复核一次;force timer 只负责发 SIGKILL.
  await new Promise((resolve) => setTimeout(resolve, 70));
  assert.ok(signals.some(([pid, signal]) => pid === 12346 && signal === 'SIGKILL'));
  assert.equal(manager.getJob(id).status, 'failed');
});

test('重复取消与 shutdown 共用同一个终止流程,不重复发送 TERM', () => {
  const child = makeFakeChild({autoCloseOnExit: false});
  const signals = [];
  const manager = createJobManager({
    spawnImpl: () => child,
    killImpl: (pid, signal) => signals.push([pid, signal]),
    forceKillAfterMs: 1000,
  });
  const {id} = manager.createJob({kind: 'still', folder: STILL_FIXTURE, options: {}});
  assert.equal(manager.cancelJob(id), true);
  assert.equal(manager.cancelJob(id), false);
  void manager.killAll({deadlineMs: 1});
  assert.deepEqual(signals.filter(([, signal]) => signal === 'SIGTERM'), [[-12345, 'SIGTERM'], [12345, 'SIGTERM']]);
});

test('spawn 后父进程登记 executor 失败且身份不可证实时保留 lease', () => {
  const child = makeFakeChild({autoCloseOnExit: false});
  child.pid = process.pid;
  const lease = {id: 'registration-race', token: 'token', taskRoot: '/tmp/registration-race'};
  let releases = 0;
  const leaseManager = {
    acquire: () => lease, markSpawnIntent: () => {},
    registerExecutor: () => { throw new Error('executor identity 不匹配'); },
    release: () => { releases += 1; return true; },
  };
  const manager = createJobManager({
    spawnImpl: () => child, leaseManager, killImpl: () => {},
    readProcessTable: () => `${process.pid} 1 ${new Date().toString()}\n`,
  });
  assert.throws(() => manager.createJob({kind: 'still', folder: STILL_FIXTURE, options: {}}), /identity 不匹配/);
  assert.equal(manager.getJob(lease.id).status, 'failed');
  assert.equal(releases, 0, '已 spawn 的 child 未确认退出前不能直接释放 lease');
});

test('Windows 终止不读取 ps 快照,taskkill 成功后仍要求 child close 与平台判活', async () => {
  const child = makeFakeChild({autoCloseOnExit: false});
  let alive = true;
  const manager = createJobManager({
    spawnImpl: () => child, leaseManager: makeCanonicalLeaseManager(), platform: 'win32',
    readProcessTable: () => { throw new Error('Windows must not call ps'); },
    taskkillImpl: async () => {}, executorLivenessImpl: () => alive ? 'alive' : 'dead', forceKillAfterMs: 100,
  });
  const {id} = manager.createJob({kind: 'still', folder: STILL_FIXTURE, options: {}});
  manager.cancelJob(id);
  alive = false;
  child.emit('close', null);
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(manager.getJob(id).status, 'cancelled');
});

test('Windows does not taskkill an executor with unknown liveness and retains its lease', async () => {
  const child = makeFakeChild({autoCloseOnExit: false});
  const taskkillCalls = [];
  const releases = [];
  const manager = createJobManager({
    spawnImpl: () => child,
    leaseManager: makeCanonicalLeaseManager({onRelease: (lease) => releases.push(lease.id)}),
    platform: 'win32',
    taskkillImpl: async (pid, force) => taskkillCalls.push([pid, force]),
    executorLivenessImpl: () => 'unknown',
  });
  const {id} = manager.createJob({kind: 'still', folder: STILL_FIXTURE, options: {}});
  manager.cancelJob(id);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(taskkillCalls, []);
  assert.equal(manager.getJob(id).status, 'failed');
  assert.deepEqual(releases, []);
});

test('正常结束的任务不该收到任何信号', async () => {
  const child = makeFakeChild();
  const signals = [];
  const manager = createJobManager({
    spawnImpl: () => child,
    killImpl: (pid, signal) => signals.push([pid, signal]),
  });
  const {id} = manager.createJob({kind: 'still', folder: STILL_FIXTURE, options: {}});
  child.emit('exit', 0);
  await new Promise((resolve) => setTimeout(resolve, 3200));
  assert.deepEqual(signals, [], '没取消过的任务不该被杀');
  assert.equal(manager.getJob(id).status, 'done');
});

test('a spawn failure releases the concurrency lock instead of wedging it', () => {
  const child = makeFakeChild({pid: null});
  const manager = createJobManager({spawnImpl: () => child, killImpl: () => {}});
  const first = manager.createJob({kind: 'still', folder: STILL_FIXTURE, options: {}});
  // 没有 pid 说明 spawn 根本没创建进程,可直接释放并发锁.
  assert.equal(manager.getJob(first.id).status, 'failed');
  const second = manager.createJob({kind: 'still', folder: STILL_FIXTURE, options: {}});
  assert.ok(second.id, '第一个任务失败后应当能再起一个,而不是一直 409');
});

test('a spawn failure notifies subscribers with an end frame', () => {
  const child = makeFakeChild({pid: null});
  const manager = createJobManager({spawnImpl: () => child, killImpl: () => {}});
  const {id} = manager.createJob({kind: 'still', folder: STILL_FIXTURE, options: {}});
  const chunks = [];
  manager.subscribeEvents(id, (chunk) => chunks.push(chunk));
  assert.ok(chunks.some((chunk) => chunk.startsWith('event: end\n')), '订阅者不该干等一个永远不来的结束');
});

test('positive pid with an unknown start probe may use the child self-registration identity', () => {
  const child = makeFakeChild({pid: 987654321});
  const lease = {id: 'self-registered', token: 'token', taskRoot: '/tmp/self-registered'};
  const canonical = {pid: 987654321, start: 'Mon Jan  1 00:00:00 2024'};
  let received = null;
  const leaseManager = {
    acquire: () => lease, markSpawnIntent: () => {},
    registerExecutor: (_lease, executor) => {
      received = executor;
      return canonical;
    },
    release: () => true,
  };
  const manager = createJobManager({spawnImpl: () => child, leaseManager});
  assert.ok(manager.createJob({kind: 'still', folder: STILL_FIXTURE, options: {}}).id);
  assert.deepEqual(received, {pid: 987654321, start: null});
});

test('killAll escalates every running job so Ctrl+C leaves no orphans', async () => {
  const child = makeFakeChild();
  const signals = [];
  const manager = createJobManager({
    spawnImpl: () => child,
    killImpl: (pid, signal) => signals.push([pid, signal]),
  });
  manager.createJob({kind: 'render', folder: STILL_FIXTURE, options: {}});
  const resultPromise = manager.killAll({deadlineMs: 1});
  // killAll 的 deadline 定时器会 unref;测试自己保持事件循环,等待关闭期限真正推进.
  await new Promise((resolve) => setTimeout(resolve, 5));
  const result = await resultPromise;
  assert.equal(result.clean, false);
  assert.ok(signals.some(([pid, signal]) => pid === -12345 && signal === 'SIGTERM'));
  assert.ok(signals.some(([pid, signal]) => pid === -12345 && signal === 'SIGKILL'));
});

// ---- 批 C:kind 泛化 -------------------------------------------------------

test('parseYtDlpProgress:标准进度行', () => {
  assert.deepEqual(parseYtDlpProgress('[download]  42.3% of ~10.00MiB at 1.00MiB/s ETA 00:06'), {
    kind: 'progress',
    label: '下载音频',
    percent: 42,
  });
});

test('parseYtDlpProgress:100% 与 0%', () => {
  assert.equal(parseYtDlpProgress('[download] 100% of 10.00MiB in 00:05').percent, 100);
  assert.equal(parseYtDlpProgress('[download]   0.0% of ~10.00MiB').percent, 0);
});

test('parseYtDlpProgress:带 ANSI 颜色码仍然认得出', () => {
  // 源码里不放裸 ESC 字节(不可见、容易被编辑器吃掉),现拼一个
  const esc = String.fromCharCode(27);
  const colored = `${esc}[0;94m[download]${esc}[0m ${esc}[0;33m  7.5%${esc}[0m of 10.00MiB`;
  assert.equal(parseYtDlpProgress(colored).percent, 8);
});

test('parseYtDlpProgress:畸形行一律返回 null', () => {
  for (const line of [
    '',
    null,
    undefined,
    '[download] Destination: /tmp/x.m4a',
    '[download] % of 10.00MiB',
    '[download] 999% of 10.00MiB',
    '[ExtractAudio] Destination: /tmp/x.m4a',
    'progress 42%',
  ]) {
    assert.equal(parseYtDlpProgress(line), null, `不该把 ${JSON.stringify(line)} 当成进度`);
  }
});

test('buildJobArgv:lyrics 只有 folder,多余选项一律不影响 argv', () => {
  assert.deepEqual(buildJobArgv({kind: 'lyrics', folder: '/f'}), ['lyrics', '/f']);
  assert.deepEqual(buildJobArgv({kind: 'lyrics', folder: '/f', options: {replace: true}}), ['lyrics', '/f', '--replace']);
  assert.throws(() => buildJobArgv({kind: 'lyrics', folder: '/f', options: {replace: 'yes'}}), /replace 必须是布尔值/);
  assert.deepEqual(
    buildJobArgv({kind: 'lyrics', folder: '/f', options: {format: 'bogus', scale: 99}}),
    ['lyrics', '/f'],
  );
});

test('buildJobArgv:未知 kind 仍然抛 JobValidationError', () => {
  assert.throws(() => buildJobArgv({kind: 'fetch-audio', folder: '/f'}), (error) => {
    assert.equal(error.field, 'kind');
    return true;
  });
});

test('buildJobSpec:lyrics 走 CLI + fd3', () => {
  const spec = buildJobSpec({kind: 'lyrics', folder: '/f'});
  assert.equal(spec.command, process.execPath);
  assert.equal(spec.progressSource, 'fd3');
  assert.deepEqual(spec.args.slice(-2), ['lyrics', '/f']);
  assert.equal(spec.env.TSUZURI_JSON_PROGRESS, '1');
  // stdin 必须是 ignore,否则 offerFetch 会卡在一个看不见的终端提问上
  assert.equal(spec.stdio[0], 'ignore');
});

test('buildJobSpec:render/still 的命令组装不回归', () => {
  const render = buildJobSpec({kind: 'render', folder: '/f', options: {draft: true}});
  assert.deepEqual(render.args.slice(-2), ['/f', '--draft']);
  assert.deepEqual(render.stdio, ['ignore', 'pipe', 'pipe', 'pipe']);
  assert.equal(render.progressSource, 'fd3');
  const still = buildJobSpec({kind: 'still', folder: STILL_FIXTURE});
  assert.deepEqual(still.args.slice(-2), ['still', STILL_FIXTURE]);
});

test('buildJobSpec claims the same canonical variant outputs the child CLI will write', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'tsuzuri-job-output-'));
  try {
    fs.writeFileSync(path.join(folder, 'a.jpg'), 'x');
    fs.writeFileSync(path.join(folder, 'b.png'), 'x');
    const options = {exif: true, sign: true, dark: true, format: 'square', draft: true, filter: 'mono', filterIntensity: 0.8, scale: 4};
    const render = buildJobSpec({kind: 'render', folder, options});
    assert.deepEqual(render.outputPaths, [path.join(folder, 'output', `${path.basename(folder)}-exif-sign-dark-square-draft-mono-0.8.mp4`)]);
    const still = buildJobSpec({kind: 'still', folder, options});
    assert.deepEqual(still.outputPaths, [
      path.join(folder, 'output', 'stills', 'a-exif-sign-dark-square-mono-0.8.png'),
      path.join(folder, 'output', 'stills', 'b-exif-sign-dark-square-mono-0.8.png'),
    ]);
  } finally {
    fs.rmSync(folder, {recursive: true, force: true});
  }
});

test('buildJobSpec:fetch-audio 直接跑 yt-dlp,下载到素材夹外的临时目录', () => {
  const tempParent = fs.mkdtempSync(path.join(os.tmpdir(), 'tsuzuri-jobspec-'));
  const spec = buildJobSpec({
    kind: 'fetch-audio',
    folder: '/f',
    options: {id: 'dQw4w9WgXcQ', title: 'Song', artist: 'Artist'},
    tempParent,
  });
  assert.equal(spec.command, 'yt-dlp');
  assert.equal(spec.progressSource, 'ytdlp-stdout');
  assert.ok(spec.args.includes('--newline'), '不加 --newline 就一行进度都读不到');
  assert.ok(spec.args.includes('https://www.youtube.com/watch?v=dQw4w9WgXcQ'));
  const output = spec.args[spec.args.indexOf('-o') + 1];
  assert.ok(output.startsWith(tempParent), '下载目标必须在素材夹之外');
});

test('buildJobSpec:fetch-audio 非法字段被拒绝,且不留临时目录', () => {
  const tempParent = fs.mkdtempSync(path.join(os.tmpdir(), 'tsuzuri-jobspec-'));
  const bad = [
    [{id: '../../etc/passwd', title: 'x'}, 'id'],
    [{id: 'https://evil.example/x', title: 'x'}, 'id'],
    [{id: 42, title: 'x'}, 'id'],
    [{title: 'x'}, 'id'],
    [{id: 'dQw4w9WgXcQ'}, 'title'],
    [{id: 'dQw4w9WgXcQ', title: '   '}, 'title'],
    [{id: 'dQw4w9WgXcQ', title: 'x', artist: 5}, 'artist'],
  ];
  for (const [options, field] of bad) {
    assert.throws(
      () => buildJobSpec({kind: 'fetch-audio', folder: '/f', options, tempParent}),
      (error) => {
        assert.ok(error instanceof JobValidationError);
        assert.equal(error.field, field, `options=${JSON.stringify(options)}`);
        return true;
      },
    );
  }
  assert.deepEqual(fs.readdirSync(tempParent), [], '校验失败不该在临时目录里留垃圾');
});

/** 只有三路 stdio 的假子进程:yt-dlp 不认识 fd 3,进度写在 stdout 上. */
const makeFakeYtDlpChild = () => makeFakeChild({pid: 4321, stdioCount: 3});

const makeTempDir = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

test('fetch-audio:stdout 的百分比被翻译成契约一,任务历史只保留最新 progress 快照', async () => {
  const child = makeFakeYtDlpChild();
  const manager = createJobManager({
    spawnImpl: () => child,
    killImpl: () => {},
    tempParent: makeTempDir('tsuzuri-jobrun-'),
  });
  const {id} = manager.createJob({
    kind: 'fetch-audio',
    folder: makeTempDir('tsuzuri-jobdest-'),
    options: {id: 'dQw4w9WgXcQ', title: 'Song', artist: 'Artist'},
  });

  child.stdio[1].write('[download] Destination: /tmp/x.m4a\n');
  child.stdio[1].write('[download]   0.0% of 10.00MiB\n');
  child.stdio[1].write('[download]  42.3% of 10.00MiB\n');
  child.stdio[1].write('[download]  42.4% of 10.00MiB\n');
  child.stdio[1].write('[download] 100% of 10.00MiB\n');
  await new Promise((resolve) => setImmediate(resolve));

  const progress = manager.getJob(id).events.filter((event) => event.kind === 'progress');
  assert.deepEqual(progress.map((event) => event.percent), [100]);
  assert.equal(progress[0].label, '下载音频');
  child.emit('exit', 1);
});

test('fetch-audio:下载失败时任务判 failed 并给出一条 error 事件', async () => {
  const child = makeFakeYtDlpChild();
  const manager = createJobManager({
    spawnImpl: () => child,
    killImpl: () => {},
    tempParent: makeTempDir('tsuzuri-jobrun-'),
  });
  const {id} = manager.createJob({
    kind: 'fetch-audio',
    folder: makeTempDir('tsuzuri-jobdest-'),
    options: {id: 'dQw4w9WgXcQ', title: 'Song'},
  });
  child.emit('exit', 1);
  await new Promise((resolve) => setImmediate(resolve));
  const job = manager.getJob(id);
  assert.equal(job.status, 'failed');
  assert.ok(job.events.some((event) => event.kind === 'error'));
});

test('fetch-audio:退出码 0 时把下载结果安装进 audio/ 并清掉临时目录', async () => {
  const folder = makeTempDir('tsuzuri-jobdest-');
  const child = makeFakeYtDlpChild();
  let tempDir = null;
  const manager = createJobManager({
    // 伪造一个"yt-dlp 已经下载好"的现场:往 -o 指定的临时目录里放一个音频文件
    spawnImpl: (command, args) => {
      tempDir = path.dirname(args[args.indexOf('-o') + 1]);
      fs.writeFileSync(path.join(tempDir, 'raw.m4a'), 'audio');
      return child;
    },
    killImpl: () => {},
    tempParent: makeTempDir('tsuzuri-jobrun-'),
  });
  const {id} = manager.createJob({
    kind: 'fetch-audio',
    folder,
    options: {id: 'dQw4w9WgXcQ', title: 'Song', artist: 'Artist'},
  });
  child.emit('exit', 0);
  await new Promise((resolve) => setImmediate(resolve));

  const job = manager.getJob(id);
  assert.equal(job.status, 'done');
  assert.ok(fs.existsSync(path.join(folder, 'audio', 'Song - Artist.m4a')));
  assert.ok(job.events.some((event) => event.kind === 'success'));
  assert.equal(fs.existsSync(tempDir), false, '临时目录必须被清掉');
});

test('fetch-audio:目标已存在时判 failed,不静默覆盖已有音频', async () => {
  const folder = makeTempDir('tsuzuri-jobdest-');
  fs.mkdirSync(path.join(folder, 'audio'));
  fs.writeFileSync(path.join(folder, 'audio', 'Song.m4a'), 'old');
  const child = makeFakeYtDlpChild();
  const manager = createJobManager({
    spawnImpl: (command, args) => {
      fs.writeFileSync(path.join(path.dirname(args[args.indexOf('-o') + 1]), 'raw.m4a'), 'new');
      return child;
    },
    killImpl: () => {},
    tempParent: makeTempDir('tsuzuri-jobrun-'),
  });
  const {id} = manager.createJob({kind: 'fetch-audio', folder, options: {id: 'dQw4w9WgXcQ', title: 'Song'}});
  child.emit('exit', 0);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(manager.getJob(id).status, 'failed');
  assert.equal(fs.readFileSync(path.join(folder, 'audio', 'Song.m4a'), 'utf8'), 'old');
});

test('新 kind 同样受并发锁、取消与 killAll 约束', async () => {
  const folder = makeTempDir('tsuzuri-jobdest-');
  let child;
  const signals = [];
  const manager = createJobManager({
    spawnImpl: () => {
      child = makeFakeYtDlpChild();
      return child;
    },
    killImpl: (pid, signal) => signals.push([pid, signal]),
    tempParent: makeTempDir('tsuzuri-jobrun-'),
  });
  const {id} = manager.createJob({kind: 'fetch-audio', folder, options: {id: 'dQw4w9WgXcQ', title: 'Song'}});
  assert.deepEqual(manager.createJob({kind: 'lyrics', folder}), {error: 'busy'});

  assert.equal(manager.cancelJob(id), true);
  assertGracefulTerminationSignals(signals, 4321);
  child.emit('exit', null);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(manager.getJob(id).status, 'cancelled');

  // 锁已释放,新任务能起来;killAll 对新 kind 同样生效(SIGTERM + SIGKILL 两刀)
  manager.createJob({kind: 'lyrics', folder});
  const resultPromise = manager.killAll({deadlineMs: 1});
  await new Promise((resolve) => setTimeout(resolve, 5));
  const result = await resultPromise;
  assert.equal(result.clean, false);
  assert.ok(signals.slice(4).some(([pid, signal]) => pid === -4321 && signal === 'SIGTERM'));
  assert.ok(signals.slice(4).some(([pid, signal]) => pid === -4321 && signal === 'SIGKILL'));
});

test('lyrics 任务仍然读 fd 3(泛化没有把原路径改漏)', async () => {
  const child = makeFakeChild();
  const manager = createJobManager({spawnImpl: () => child, killImpl: () => {}});
  const {id} = manager.createJob({kind: 'lyrics', folder: '/f'});
  writeNdjson(child.stdio[3], [{kind: 'progress', label: '识别歌词', percent: 30}]);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(manager.getJob(id).events, [{kind: 'progress', label: '识别歌词', percent: 30}]);
  child.emit('exit', 0);
});

test('fetch-audio:spawn 失败(没装 yt-dlp)释放并发锁并清掉临时目录', () => {
  const tempParent = makeTempDir('tsuzuri-jobrun-');
  const folder = makeTempDir('tsuzuri-jobdest-');
  const child = makeFakeChild({pid: null, stdioCount: 3});
  const manager = createJobManager({spawnImpl: () => child, killImpl: () => {}, tempParent});
  const {id} = manager.createJob({kind: 'fetch-audio', folder, options: {id: 'dQw4w9WgXcQ', title: 'Song'}});
  child.emit('error', new Error('ENOENT'));
  assert.equal(manager.getJob(id).status, 'failed');
  assert.deepEqual(fs.readdirSync(tempParent), [], 'spawn 失败也要清临时目录');
  assert.ok(manager.createJob({kind: 'lyrics', folder}).id);
});

test('fetch-audio 失败时带上 yt-dlp 的真实报错,而不是一句放之四海皆准的"下载失败"', async () => {
  const child = makeFakeChild();
  const manager = createJobManager({spawnImpl: () => child, killImpl: () => {}});
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'tsuzuri-job-'));
  const {id} = manager.createJob({
    kind: 'fetch-audio',
    folder,
    options: {id: 'dQw4w9WgXcQ', title: 'Song'},
  });
  child.stdio[2].write('ERROR: [youtube] Video unavailable\n');
  await new Promise((resolve) => setImmediate(resolve));
  child.emit('exit', 1);
  const text = manager.getJob(id).events.map((event) => event.text).join('\n');
  assert.match(text, /Video unavailable/, 'stderr 的真实原因必须带出来,否则无从排查');
});

test('yt-dlp 起不来时不该报成"网络或地区限制"', async () => {
  const child = makeFakeChild({pid: null});
  const manager = createJobManager({spawnImpl: () => child, killImpl: () => {}});
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'tsuzuri-job-'));
  const {id} = manager.createJob({
    kind: 'fetch-audio',
    folder,
    options: {id: 'dQw4w9WgXcQ', title: 'Song'},
  });
  child.emit('error', Object.assign(new Error('spawn yt-dlp ENOENT'), {code: 'ENOENT'}));
  const text = manager.getJob(id).events.map((event) => event.text).join('\n');
  assert.match(text, /起不了 yt-dlp/, '没装和下载失败是两回事,提示不能混为一谈');
});

test('CLI 入口路径必须真实存在', () => {
  // 这一条是唯一能抓到"路径拼错"的测试:其余用例全都注入 spawnImpl,
  // 永远碰不到真实文件系统.曾经这里拼出的是 cli/cli/tsuzuri.mjs,
  // 子进程起手就 Cannot find module 退出 1,stderr 被丢、fd 3 无事件,
  // 前端只看到一句"失败了"——从网页起任务这个功能整个是坏的.
  for (const kind of ['render', 'still', 'lyrics']) {
    const spec = buildJobSpec({kind, folder: STILL_FIXTURE, options: {}});
    assert.equal(spec.command, process.execPath);
    assert.ok(fs.existsSync(spec.args[0]), `${kind} 的入口不存在: ${spec.args[0]}`);
    assert.ok(spec.args[0].endsWith(path.join('cli', 'tsuzuri.mjs')), `路径可疑: ${spec.args[0]}`);
  }
});

test('listDescendants 递归枚举后代,不含自身', () => {
  // 进程组够不到 puppeteer 自己 detach 出去的 chromium,只能靠 ppid 走树.
  const table = ['  100     1', '  200   100', '  300   200', '  400     1', '  500   400'].join('\n');
  const found = listDescendants(100, () => table);
  assert.deepEqual(found.sort(), [200, 300], '只要 100 这一支,不含自身也不含别人的');
});

test('listDescendants 对畸形输出与环不炸', () => {
  assert.deepEqual(listDescendants(1, () => ''), []);
  assert.deepEqual(listDescendants(1, () => 'garbage\nnot a table'), []);
  // ppid 指回自己形成环:seen 集合必须挡住,否则死循环
  assert.deepEqual(listDescendants(7, () => '    7     7').sort(), []);
});

test('取消时冻结并快照后代,再逐个发送 SIGTERM', async () => {
  // 两个时机都是实测逼出来的:
  // 1. 快照必须在树还完整时做 —— render.mjs 一死,chromium 就被 reparent 到
  //    launchd,从我们的 pid 再也走不到它们.
  // 2. 后代必须立刻冻结并纳入 TERM 范围,不能等宽限期 —— 实测等 3 秒之后快照里的 pid 全部 ESRCH,
  //    却又有 13 个新的 chromium 在跑,快照就此失效.
  const child = makeFakeChild();
  const signals = [];
  const manager = createJobManager({
    spawnImpl: () => child,
    killImpl: (pid, signal) => signals.push([pid, signal]),
    forceKillAfterMs: 1,
    readProcessTable: () => [
      `12345 1 ${TEST_EXECUTOR_START}`,
      `55555 12345 ${TEST_EXECUTOR_START}`,
      `66666 55555 ${TEST_EXECUTOR_START}`,
    ].join('\n'),
  });
  const {id} = manager.createJob({kind: 'render', folder: '/tmp/x', options: {}});
  manager.cancelJob(id);
  // 先冻结可见树,再 TERM 自家进程组;后代不会在快照和 TERM 之间 reparent.
  assert.deepEqual(signals[0], [-12345, 'SIGSTOP']);
  assert.deepEqual(
    signals.filter(([pid, signal]) => signal === 'SIGTERM' && pid > 0 && pid !== 12345).map(([pid]) => pid).sort(),
    [55555, 66666],
    'detach 出去的孙进程必须立刻被逐个纳入终止范围',
  );

  child.emit('exit', null);
  await new Promise((resolve) => setTimeout(resolve, 70));
  // 宽限期过后仍对整个进程组补一刀,兜住扛过 SIGTERM 的自家进程
  assert.ok(signals.some(([pid, signal]) => pid === -12345 && signal === 'SIGKILL'));
});

// --- 遗留项:停滞看门狗、任务表上限、临时目录收尾 --------------------------

/** 停滞阈值与轮询间隔都调到毫秒级,免得单测干等两分钟. */
const fastStallDeps = (extra = {}) => ({
  killImpl: () => {},
  stallTimeoutMs: 50,
  stallCheckIntervalMs: 10,
  ...extra,
});

test('fetch-audio 长时间无进展会被中止,并说明卡在哪', async () => {
  // 卡在 0% 的下载(代理挂了但 TCP 不断)会永远占着并发锁,
  // 用户不点取消就再也起不了任何任务.
  const child = makeFakeYtDlpChild();
  const manager = createJobManager(fastStallDeps({
    spawnImpl: () => child,
    tempParent: makeTempDir('tsuzuri-stall-'),
  }));
  const folder = makeTempDir('tsuzuri-stalldest-');
  const {id} = manager.createJob({kind: 'fetch-audio', folder, options: {id: 'dQw4w9WgXcQ', title: 'Song'}});

  await new Promise((resolve) => setTimeout(resolve, 200));
  const texts = manager.getJob(id).events.map((event) => event.text ?? '').join(' ');
  assert.match(texts, /没有进展/, '必须说清是卡住了,而不是无声无息地停在那');
});

test('lyrics 这类长时间静默的任务不该被停滞看门狗误杀', async () => {
  // whisper 会先安静好几分钟再一次性吐结果,挂上看门狗必然误杀
  const child = makeFakeChild();
  const manager = createJobManager(fastStallDeps({spawnImpl: () => child}));
  const {id} = manager.createJob({kind: 'lyrics', folder: STILL_FIXTURE});

  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(manager.getJob(id).status, 'running', '静默不等于卡死');
  assert.deepEqual(manager.getJob(id).events, []);
});

test('收到进度就重新计时,下载中的任务不会被误判为停滞', async () => {
  const child = makeFakeYtDlpChild();
  const manager = createJobManager(fastStallDeps({
    spawnImpl: () => child,
    stallTimeoutMs: 120,
    tempParent: makeTempDir('tsuzuri-alive-'),
  }));
  const folder = makeTempDir('tsuzuri-alivedest-');
  const {id} = manager.createJob({kind: 'fetch-audio', folder, options: {id: 'dQw4w9WgXcQ', title: 'Song'}});

  for (let percent = 1; percent <= 6; percent += 1) {
    child.stdio[1].write(`[download]  ${percent}.0% of 3MiB\n`);
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  const texts = manager.getJob(id).events.map((event) => event.text ?? '').join(' ');
  assert.doesNotMatch(texts, /没有进展/, '一直有进度就不该被中止');
});

test('任务表只保留最近若干条,不无限攒 events', async () => {
  const manager = createJobManager({spawnImpl: makeFakeChild, killImpl: () => {}});
  const ids = [];
  for (let i = 0; i < 25; i += 1) {
    const {id} = manager.createJob({kind: 'still', folder: STILL_FIXTURE, options: {}});
    ids.push(id);
    // 立刻结束,好让下一个能起来(makeFakeChild 每次都是新实例,直接发 exit)
    manager.cancelJob(id);
    await new Promise((resolve) => setImmediate(resolve));
  }
  const alive = ids.filter((id) => manager.getJob(id) !== null);
  assert.ok(alive.length <= 21, `期望被剪到 20 条上下,实际还剩 ${alive.length}`);
  assert.ok(alive.length > 0, '不该把记录全清光');
});

test('killAll 无法确认进程树退出时保留 fetch-audio task lease', async () => {
  const child = makeFakeYtDlpChild();
  const tempParent = makeTempDir('tsuzuri-killall-');
  const manager = createJobManager({spawnImpl: () => child, killImpl: () => {}, tempParent});
  const folder = makeTempDir('tsuzuri-killalldest-');
  manager.createJob({kind: 'fetch-audio', folder, options: {id: 'dQw4w9WgXcQ', title: 'Song'}});

  // 下载 staging 位于 task lease,而非可由调用方观察的系统临时目录.
  assert.deepEqual(fs.readdirSync(tempParent), []);
  const resultPromise = manager.killAll({deadlineMs: 1});
  // killAll 的 deadline 定时器会 unref;测试自己保持事件循环,等待关闭期限真正推进.
  await new Promise((resolve) => setTimeout(resolve, 5));
  const result = await resultPromise;
  assert.equal(result.clean, false, '未确认子进程退出时必须保留 lease,不能抢先删除 staging');
});

// --- 渲染速度档位 ----------------------------------------------------------

test('speed 档位映射成 TSUZURI_CONCURRENCY,并透传诊断标签', () => {
  // balanced 不设并发值是刻意的:直接用 CLI 的默认(一半核心),少一个会跑偏的来源
  const of = (speed) => buildJobSpec({kind: 'render', folder: '/tmp/x', options: {speed}}).env.TSUZURI_CONCURRENCY;
  assert.equal(of('saver'), '25%');
  assert.equal(of('full'), '90%');
  assert.equal(of('balanced'), undefined);
  assert.equal(buildJobSpec({kind: 'render', folder: '/tmp/x', options: {}}).env.TSUZURI_CONCURRENCY, undefined);
  assert.equal(buildJobSpec({kind: 'render', folder: '/tmp/x', options: {speed: 'full'}}).env.TSUZURI_RENDER_SPEED, 'full');
  assert.equal(buildJobSpec({kind: 'render', folder: '/tmp/x', options: {}}).env.TSUZURI_RENDER_SPEED, 'balanced');
});

test('非法 speed 抛 JobValidationError,前端碰不到任意字符串', () => {
  assert.throws(
    () => buildJobSpec({kind: 'render', folder: '/tmp/x', options: {speed: '999%'}}),
    (error) => {
      assert.ok(error instanceof JobValidationError);
      assert.equal(error.field, 'speed');
      return true;
    },
  );
});

test('speed 不会漏进 argv —— 它只影响环境变量', () => {
  const spec = buildJobSpec({kind: 'render', folder: '/tmp/x', options: {speed: 'full'}});
  assert.ok(!spec.args.some((arg) => /speed|concurrency|90/.test(arg)), `argv 被污染了: ${spec.args.join(' ')}`);
});

test('buildJobEnv: 速度档位透传,saver/full 额外覆盖并发', () => {
  assert.deepEqual(buildJobEnv({speed: 'saver'}), {TSUZURI_RENDER_SPEED: 'saver', TSUZURI_CONCURRENCY: '25%'});
  assert.deepEqual(buildJobEnv({speed: 'full'}), {TSUZURI_RENDER_SPEED: 'full', TSUZURI_CONCURRENCY: '90%'});
  assert.deepEqual(buildJobEnv({speed: 'balanced'}), {TSUZURI_RENDER_SPEED: 'balanced'});
  assert.deepEqual(buildJobEnv({}), {TSUZURI_RENDER_SPEED: 'balanced'});
});

test('buildJobEnv: 非法 speed 抛 JobValidationError,field 为 speed', () => {
  assert.throws(() => buildJobEnv({speed: 'turbo'}), (error) => {
    assert.ok(error instanceof JobValidationError);
    assert.equal(error.field, 'speed');
    return true;
  });
});

test('buildJobInvocation 的 argv 与 buildJobSpec 实际 args 尾部逐项相等(防止两边分叉)', () => {
  const cases = [
    {kind: 'render', folder: '/f', options: {draft: true, format: 'square', speed: 'full'}},
    {kind: 'still', folder: STILL_FIXTURE, options: {scale: 4, exif: true}},
    {kind: 'lyrics', folder: '/f', options: {}},
  ];
  for (const {kind, folder, options} of cases) {
    const {argv} = buildJobInvocation({kind, folder, options});
    const spec = buildJobSpec({kind, folder, options});
    assert.deepEqual(spec.args.slice(-argv.length), argv, JSON.stringify({kind, folder, options}));
  }
});

test('getRunningJob: 无任务时返回 null', () => {
  const manager = createJobManager({spawnImpl: makeFakeChild});
  assert.equal(manager.getRunningJob(), null);
});

test('getRunningJob: 创建任务后返回 {id, kind, folder}', () => {
  const manager = createJobManager({spawnImpl: makeFakeChild});
  const {id} = manager.createJob({kind: 'render', folder: '/f'});
  assert.deepEqual(manager.getRunningJob(), {id, kind: 'render', folder: '/f'});
});

test('getRunningJob: 任务结束后回到 null', async () => {
  let child;
  const spawnImpl = () => {
    child = makeFakeChild();
    return child;
  };
  const manager = createJobManager({spawnImpl});
  manager.createJob({kind: 'render', folder: '/f'});
  child.emit('exit', 0);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(manager.getRunningJob(), null);
});
