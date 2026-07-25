import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {PassThrough} from 'node:stream';
import test from 'node:test';

import {
  buildJobArgv,
  buildJobSpec,
  createJobManager,
  JobValidationError,
  parseYtDlpProgress,
} from './jobs.mjs';

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
  const still = buildJobSpec({kind: 'still', folder: '/f'});
  assert.deepEqual(still.args.slice(-4), ['still', '/f', '--scale', '2']);
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

/** 只有三路 stdio 的假子进程:yt-dlp 不认识 fd 3,进度写在 stdout 上。 */
const makeFakeYtDlpChild = () => {
  const child = new EventEmitter();
  child.pid = 4321;
  child.stdio = [null, new PassThrough(), new PassThrough()];
  child.kill = () => {};
  return child;
};

const makeTempDir = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

test('fetch-audio:stdout 的百分比被翻译成契约一的 progress 事件,重复百分比去重', async () => {
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
  assert.deepEqual(progress.map((event) => event.percent), [0, 42, 100]);
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
  const child = makeFakeYtDlpChild();
  const signals = [];
  const manager = createJobManager({
    spawnImpl: () => child,
    killImpl: (pid, signal) => signals.push([pid, signal]),
    tempParent: makeTempDir('tsuzuri-jobrun-'),
  });
  const {id} = manager.createJob({kind: 'fetch-audio', folder, options: {id: 'dQw4w9WgXcQ', title: 'Song'}});
  assert.deepEqual(manager.createJob({kind: 'lyrics', folder}), {error: 'busy'});

  assert.equal(manager.cancelJob(id), true);
  assert.deepEqual(signals, [[-4321, 'SIGTERM']]);
  child.emit('exit', null);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(manager.getJob(id).status, 'cancelled');

  // 锁已释放,新任务能起来;killAll 对新 kind 同样生效
  manager.createJob({kind: 'lyrics', folder});
  manager.killAll();
  assert.equal(signals.length, 2);
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
  const child = makeFakeYtDlpChild();
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
  const child = makeFakeChild();
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
  // 永远碰不到真实文件系统。曾经这里拼出的是 cli/cli/tsuzuri.mjs,
  // 子进程起手就 Cannot find module 退出 1,stderr 被丢、fd 3 无事件,
  // 前端只看到一句"失败了"——从网页起任务这个功能整个是坏的。
  for (const kind of ['render', 'still', 'lyrics']) {
    const spec = buildJobSpec({kind, folder: '/tmp/x', options: {}});
    assert.equal(spec.command, process.execPath);
    assert.ok(fs.existsSync(spec.args[0]), `${kind} 的入口不存在: ${spec.args[0]}`);
    assert.ok(spec.args[0].endsWith(path.join('cli', 'tsuzuri.mjs')), `路径可疑: ${spec.args[0]}`);
  }
});
