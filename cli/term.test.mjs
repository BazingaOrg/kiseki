import assert from 'node:assert/strict';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import {delimiter, join} from 'node:path';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import {fileURLToPath} from 'node:url';

import {parseArgs} from './options.mjs';
import {createPercentProgress} from './progress.mjs';
import {computeInputHash, copyLegacyJson, ensureProjectDirs, resolveProjectPaths} from './project.mjs';
import {createTerminal, dim, paint, promptPrefix} from './term.mjs';

const stream = (isTTY) => ({
  isTTY,
  output: '',
  write(chunk) {
    this.output += chunk;
  },
});

test('TTY uses matching colors and writes warnings/errors to stderr', () => {
  const stdout = stream(true);
  const stderr = stream(true);
  const output = createTerminal({stdout, stderr, env: {TERM: 'xterm-256color'}});

  output.info('信息');
  output.start('开始');
  output.success('完成');
  output.warn('提醒');
  output.error('失败');
  output.detail('细节');

  assert.equal(
    stdout.output,
    '\x1b[39m●\x1b[0m 信息\n' +
      '\x1b[38;2;217;119;87m●\x1b[0m 开始\n' +
      '\x1b[32m●\x1b[0m 完成\n' +
      '\x1b[2m└ 细节\x1b[0m\n',
  );
  assert.equal(stderr.output, '\x1b[33m●\x1b[0m 提醒\n\x1b[31m●\x1b[0m 失败\n');
});

test('color decision follows the destination stream', () => {
  const stdout = stream(true);
  const stderr = stream(false);
  const output = createTerminal({stdout, stderr, env: {TERM: 'xterm'}});

  output.start('stdout');
  output.warn('stderr');

  assert.match(stdout.output, /^\x1b\[/);
  assert.equal(stderr.output, '● stderr\n');
});

test('prompt helpers color only on an ANSI-capable destination', () => {
  const tty = stream(true);
  const plain = stream(false);
  const env = {TERM: 'xterm-256color'};

  assert.equal(paint('start', '开始', tty, env), '\x1b[38;2;217;119;87m开始\x1b[0m');
  assert.equal(dim('图例', tty, env), '\x1b[2m图例\x1b[0m');
  assert.equal(promptPrefix(tty, env), '\x1b[36m?\x1b[0m');
  assert.equal(promptPrefix(plain, env), '?');
  assert.equal(dim('图例', tty, {...env, NO_COLOR: ''}), '图例');
  assert.equal(paint('start', '开始', tty, {TERM: 'dumb'}), '开始');
});

for (const [name, isTTY, env] of [
  ['non-TTY', false, {TERM: 'xterm'}],
  ['NO_COLOR', true, {TERM: 'xterm', NO_COLOR: ''}],
  ['TERM=dumb', true, {TERM: 'dumb'}],
]) {
  test(`${name} disables ANSI`, () => {
    const stdout = stream(isTTY);
    const stderr = stream(isTTY);
    const output = createTerminal({stdout, stderr, env});

    output.start('运行');
    output.success('完成');
    output.warn('提醒');
    output.detail('明细');

    assert.doesNotMatch(stdout.output + stderr.output, /\x1b\[/);
  });
}

test('multiline CJK messages repeat their prefix', () => {
  const stdout = stream(false);
  const stderr = stream(false);
  const output = createTerminal({stdout, stderr, env: {}});

  output.info('第一行\n第二行');
  output.error('错误甲\n错误乙');
  output.detail('细节一\n细节二');

  assert.equal(stdout.output, '● 第一行\n● 第二行\n└ 细节一\n└ 细节二\n');
  assert.equal(stderr.output, '● 错误甲\n● 错误乙\n');
});

test('TSUZURI_JSON_PROGRESS 关闭时终端输出与开启前逐字节一致', () => {
  const run = (env) => {
    const stdout = stream(true);
    const stderr = stream(true);
    const output = createTerminal({stdout, stderr, env});
    output.info('信息');
    output.start('开始');
    output.success('完成');
    output.warn('提醒');
    output.error('失败');
    output.detail('细节一\n细节二');
    return {stdout: stdout.output, stderr: stderr.output};
  };

  const withoutFlag = run({TERM: 'xterm-256color'});
  const flagOff = run({TERM: 'xterm-256color', TSUZURI_JSON_PROGRESS: '0'});
  const flagUnset = run({TERM: 'xterm-256color', TSUZURI_JSON_PROGRESS: undefined});

  assert.deepEqual(flagOff, withoutFlag);
  assert.deepEqual(flagUnset, withoutFlag);
});

test('TSUZURI_JSON_PROGRESS=1 时每次调用向 JSON 出口发一条对应 kind 的事件', () => {
  const stdout = stream(true);
  const stderr = stream(true);
  const events = [];
  const output = createTerminal({
    stdout,
    stderr,
    env: {TERM: 'xterm-256color', TSUZURI_JSON_PROGRESS: '1'},
    jsonWrite: (event) => events.push(event),
  });

  output.info('信息');
  output.start('开始');
  output.success('完成');
  output.warn('提醒');
  output.error('失败');
  output.detail('细节');

  assert.deepEqual(events, [
    {kind: 'info', text: '信息'},
    {kind: 'start', text: '开始'},
    {kind: 'success', text: '完成'},
    {kind: 'warn', text: '提醒'},
    {kind: 'error', text: '失败'},
    {kind: 'detail', text: '细节'},
  ]);
  // 终端输出不受 JSON 出口影响,与关闭开关时完全一致的写法。
  assert.equal(
    stdout.output,
    '\x1b[39m●\x1b[0m 信息\n' +
      '\x1b[38;2;217;119;87m●\x1b[0m 开始\n' +
      '\x1b[32m●\x1b[0m 完成\n' +
      '\x1b[2m└ 细节\x1b[0m\n',
  );
  assert.equal(stderr.output, '\x1b[33m●\x1b[0m 提醒\n\x1b[31m●\x1b[0m 失败\n');
});

test('多行消息按行拆成多条 JSON 事件,与终端换行行为一致', () => {
  const stdout = stream(false);
  const stderr = stream(false);
  const events = [];
  const output = createTerminal({
    stdout,
    stderr,
    env: {TSUZURI_JSON_PROGRESS: '1'},
    jsonWrite: (event) => events.push(event),
  });

  output.info('第一行\n第二行');
  output.error('错误甲\n错误乙');

  assert.deepEqual(events, [
    {kind: 'info', text: '第一行'},
    {kind: 'info', text: '第二行'},
    {kind: 'error', text: '错误甲'},
    {kind: 'error', text: '错误乙'},
  ]);
});

test('开关开启但 fd 3 未打开时,默认 JSON 写入器吞掉 EBADF 且不影响终端输出', () => {
  const stdout = stream(true);
  const stderr = stream(true);
  // 不注入 jsonWrite,走真实的 defaultJsonWrite → fs.writeSync(3, ...)。
  // 测试进程通常没有打开 fd 3,预期抛 EBADF 并被内部吞掉。
  const output = createTerminal({stdout, stderr, env: {TSUZURI_JSON_PROGRESS: '1'}});

  assert.doesNotThrow(() => {
    output.info('信息');
    output.warn('提醒');
    output.detail('细节');
  });

  assert.equal(stdout.output, '\x1b[39m●\x1b[0m 信息\n\x1b[2m└ 细节\x1b[0m\n');
  assert.equal(stderr.output, '\x1b[33m●\x1b[0m 提醒\n');
});

test('output option requires a value', () => {
  assert.throws(() => parseArgs(['album', '-o']), /需要输出文件路径/);
  assert.throws(() => parseArgs(['album', '--output']), /需要输出文件路径/);
});

test('interactive render progress uses stable-width bars and percentages', () => {
  const stdout = stream(true);
  const progress = createPercentProgress({stream: stdout});

  progress.update('Rendering frames', 0.07);
  progress.update('Rendering frames', 0.42);
  progress.update('Encoding video', 1);
  progress.finish();

  assert.equal(
    stdout.output,
    '\r\x1b[2K└ Rendering frames   [█░░░░░░░░░░░░░░░░░░░]   7%' +
      '\r\x1b[2K└ Rendering frames   [████████░░░░░░░░░░░░]  42%\n' +
      '\r\x1b[2K└ Encoding video     [████████████████████] 100%\n',
  );
  assert.doesNotMatch(stdout.output, /remaining|\d+s/);
});

test('redirected render progress emits bar and percentage milestones', () => {
  const stdout = stream(false);
  const progress = createPercentProgress({stream: stdout});

  for (const value of [0, 0.1, 0.24, 0.25, 0.51, 0.76, 1]) {
    progress.update('Rendering frames', value);
  }
  progress.finish();

  assert.equal(
    stdout.output,
    '└ Rendering frames   [░░░░░░░░░░░░░░░░░░░░]   0%\n' +
      '└ Rendering frames   [█████░░░░░░░░░░░░░░░]  25%\n' +
      '└ Rendering frames   [██████████░░░░░░░░░░]  51%\n' +
      '└ Rendering frames   [███████████████░░░░░]  76%\n' +
      '└ Rendering frames   [████████████████████] 100%\n',
  );
});

test('project paths separate generated JSON and video output', () => {
  const paths = resolveProjectPaths('/tmp/summer-album');

  assert.equal(paths.metadataDir, '/tmp/summer-album/output/metadata');
  assert.equal(paths.beatsPath, '/tmp/summer-album/output/metadata/beats.json');
  assert.equal(paths.lyricsPath, '/tmp/summer-album/output/metadata/lyrics.json');
  assert.equal(paths.analysisPath, '/tmp/summer-album/output/metadata/analysis.json');
  assert.equal(paths.timelinePath, '/tmp/summer-album/output/metadata/timeline.json');
  assert.equal(paths.preferencesPath, '/tmp/summer-album/output/metadata/preferences.json');
  assert.equal(paths.outputPath, '/tmp/summer-album/output/summer-album.mp4');
  assert.equal(resolveProjectPaths('/tmp/summer-album', './film.mp4').outputPath, join(process.cwd(), 'film.mp4'));
});

test('an output suffix is appended to the default filename but not to an explicit -o path', () => {
  assert.equal(
    resolveProjectPaths('/tmp/summer-album', null, '-exif-sign-dark').outputPath,
    '/tmp/summer-album/output/summer-album-exif-sign-dark.mp4',
  );
  assert.equal(
    resolveProjectPaths('/tmp/summer-album', './film.mp4', '-exif-sign-dark').outputPath,
    join(process.cwd(), 'film.mp4'),
  );
  assert.equal(
    resolveProjectPaths('/tmp/summer-album', null, '-draft').outputPath,
    '/tmp/summer-album/output/summer-album-draft.mp4',
  );
});

test('legacy JSON is copied once without removing or overwriting files', () => {
  const root = mkdtempSync(join(tmpdir(), 'tsuzuri-layout-'));
  try {
    const paths = resolveProjectPaths(root);
    writeFileSync(join(root, 'beats.json'), 'legacy beats');
    writeFileSync(join(root, 'lyrics.json'), 'legacy lyrics');
    ensureProjectDirs(paths);
    writeFileSync(paths.lyricsPath, 'new lyrics');

    assert.deepEqual(copyLegacyJson(root, paths.metadataDir), ['beats.json']);
    assert.equal(readFileSync(paths.beatsPath, 'utf8'), 'legacy beats');
    assert.equal(readFileSync(paths.lyricsPath, 'utf8'), 'new lyrics');
    assert.ok(existsSync(join(root, 'beats.json')));
    assert.ok(existsSync(join(root, 'lyrics.json')));
    assert.ok(existsSync(join(root, 'output')));
    assert.deepEqual(copyLegacyJson(root, paths.metadataDir), []);
  } finally {
    rmSync(root, {recursive: true, force: true});
  }
});

test('input hash changes when user lyrics change', () => {
  const root = mkdtempSync(join(tmpdir(), 'tsuzuri-hash-'));
  try {
    writeFileSync(join(root, 'song.mp3'), 'audio');
    writeFileSync(join(root, 'lyrics.lrc'), '[00:01.00]first');
    const first = computeInputHash(root, ['song.mp3', 'lyrics.lrc']);
    writeFileSync(join(root, 'lyrics.lrc'), '[00:01.00]second');

    assert.notEqual(computeInputHash(root, ['song.mp3', 'lyrics.lrc']), first);
  } finally {
    rmSync(root, {recursive: true, force: true});
  }
});

test(
  'the executable still runs through a package-style symlink',
  {skip: process.platform === 'win32'},
  () => {
    const root = mkdtempSync(join(tmpdir(), 'tsuzuri-bin-'));
    try {
      const script = fileURLToPath(new URL('./tsuzuri.mjs', import.meta.url));
      const link = join(root, 'tsuzuri');
      symlinkSync(script, link);

      const result = spawnSync(link, {encoding: 'utf8'});

      assert.equal(result.status, 1, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
      assert.match(result.stderr, /● tsuzuri: 用法/);
    } finally {
      rmSync(root, {recursive: true, force: true});
    }
  },
);

test(
  'analyzer failure reports its stage and preserves the exit code',
  {skip: process.platform === 'win32'},
  () => {
    const root = mkdtempSync(join(tmpdir(), 'tsuzuri-cli-'));
    try {
      const album = join(root, 'album');
      const bin = join(root, 'bin');
      mkdirSync(album);
      mkdirSync(bin);
      writeFileSync(join(album, 'photo.jpg'), 'photo');
      writeFileSync(join(album, 'song.mp3'), 'audio');
      const uv = join(bin, 'uv');
      writeFileSync(uv, '#!/bin/sh\nexit 7\n');
      chmodSync(uv, 0o755);

      const script = fileURLToPath(new URL('./tsuzuri.mjs', import.meta.url));
      const result = spawnSync(process.execPath, [script, album], {
        encoding: 'utf8',
        env: {...process.env, PATH: `${bin}${delimiter}${process.env.PATH ?? ''}`},
      });

      assert.equal(result.status, 7, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
      assert.match(result.stdout, /● 分析音频/);
      assert.match(result.stderr, /● 分析音频失败\(退出码 7\)/);
    } finally {
      rmSync(root, {recursive: true, force: true});
    }
  },
);

test(
  'a single LRC is forwarded to the analyzer and generated paths use metadata',
  {skip: process.platform === 'win32'},
  () => {
    const root = mkdtempSync(join(tmpdir(), 'tsuzuri-lrc-cli-'));
    try {
      const album = join(root, 'album');
      const bin = join(root, 'bin');
      const argsLog = join(root, 'uv-args.txt');
      mkdirSync(album);
      mkdirSync(bin);
      writeFileSync(join(album, 'photo.jpg'), 'photo');
      writeFileSync(join(album, 'song.mp3'), 'audio');
      writeFileSync(join(album, 'lyrics.lrc'), '[00:00.00]歌词');
      const uv = join(bin, 'uv');
      writeFileSync(uv, '#!/bin/sh\nprintf "%s\\n" "$@" > "$TSUZURI_TEST_ARGS"\nexit 7\n');
      chmodSync(uv, 0o755);

      const script = fileURLToPath(new URL('./tsuzuri.mjs', import.meta.url));
      const result = spawnSync(process.execPath, [script, album], {
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${bin}${delimiter}${process.env.PATH ?? ''}`,
          TSUZURI_TEST_ARGS: argsLog,
        },
      });
      const forwarded = readFileSync(argsLog, 'utf8');

      assert.equal(result.status, 7);
      assert.match(forwarded, /--lyrics-file\n.*lyrics\.lrc/);
      assert.match(forwarded, /-o\n.*output\/metadata\/beats\.json/);
      assert.match(forwarded, /--lyrics-output\n.*output\/metadata\/lyrics\.json/);
      assert.ok(existsSync(join(album, 'output', 'metadata')));
      assert.ok(existsSync(join(album, 'output')));
    } finally {
      rmSync(root, {recursive: true, force: true});
    }
  },
);

test(
  'analysis cache skips added photos but invalidates for changed audio and legacy projects',
  {skip: process.platform === 'win32'},
  () => {
    const root = mkdtempSync(join(tmpdir(), 'tsuzuri-analysis-cli-'));
    try {
      const album = join(root, 'album');
      const bin = join(root, 'bin');
      const calls = join(root, 'uv-calls.jsonl');
      mkdirSync(album);
      mkdirSync(bin);
      writeFileSync(join(album, 'photo.jpg'), 'photo');
      writeFileSync(join(album, 'song.mp3'), 'audio');
      const uv = join(bin, 'uv');
      writeFileSync(
        uv,
        '#!/usr/bin/env node\n' +
          'const fs = require("fs");\n' +
          'const args = process.argv.slice(2);\n' +
          'fs.appendFileSync(process.env.TSUZURI_TEST_CALLS, JSON.stringify(args) + "\\n");\n' +
          'const valueAfter = (flag) => args[args.indexOf(flag) + 1];\n' +
          'if (args.includes("tsuzuri-analysis-fingerprint")) {\n' +
          '  console.log("{\\"version\\":1,\\"beat_features_version\\":1,\\"backend\\":\\"cpu\\",\\"model\\":\\"small\\",\\"demucs_available\\":false}");\n' +
          '  process.exit(0);\n' +
          '}\n' +
          'if (args.includes("tsuzuri-analyze")) {\n' +
          '  fs.writeFileSync(valueAfter("-o"), "{\\"version\\":1}");\n' +
          '  fs.writeFileSync(valueAfter("--lyrics-output"), "{\\"version\\":1,\\"segments\\":[]}");\n' +
          '  process.exit(0);\n' +
          '}\n' +
          'process.exit(7);\n',
      );
      chmodSync(uv, 0o755);
      const script = fileURLToPath(new URL('./tsuzuri.mjs', import.meta.url));
      const env = {
        ...process.env,
        PATH: `${bin}${delimiter}${process.env.PATH ?? ''}`,
        TSUZURI_TEST_CALLS: calls,
      };
      const run = () => spawnSync(process.execPath, [script, album], {encoding: 'utf8', env});
      const readCalls = () => readFileSync(calls, 'utf8').trim().split('\n').map(JSON.parse);
      const readPipelineCalls = () => readCalls().filter((args) => !args.includes('tsuzuri-analysis-fingerprint'));

      const legacy = run();
      assert.equal(legacy.status, 7);
      assert.deepEqual(readPipelineCalls().map((args) => args.includes('tsuzuri-analyze')), [true, false]);
      assert.ok(existsSync(join(album, 'output', 'metadata', 'analysis.json')));

      writeFileSync(calls, '');
      writeFileSync(join(album, 'photo-2.jpg'), 'photo 2');
      const photosChanged = run();
      assert.equal(photosChanged.status, 7);
      assert.deepEqual(readPipelineCalls().map((args) => args.includes('tsuzuri-analyze')), [false]);
      assert.match(photosChanged.stdout, /音频和歌词未变,跳过音频分析/);

      writeFileSync(calls, '');
      writeFileSync(join(album, 'song.mp3'), 'changed audio');
      const audioChanged = run();
      assert.equal(audioChanged.status, 7);
      assert.deepEqual(readPipelineCalls().map((args) => args.includes('tsuzuri-analyze')), [true, false]);
    } finally {
      rmSync(root, {recursive: true, force: true});
    }
  },
);

test(
  'CLI trim precedence and choices pass the intended planner overrides',
  {skip: process.platform === 'win32'},
  () => {
    const root = mkdtempSync(join(tmpdir(), 'tsuzuri-trim-cli-'));
    try {
      const bin = join(root, 'bin');
      const callsPath = join(root, 'calls.json');
      const runner = join(root, 'run-trim.mjs');
      mkdirSync(bin);
      writeFileSync(
        join(bin, 'uv'),
        '#!/usr/bin/env node\n' +
          'if (process.argv.includes("tsuzuri-analysis-fingerprint")) console.log("{\\"version\\":1,\\"beat_features_version\\":1,\\"backend\\":\\"cpu\\",\\"model\\":\\"small\\",\\"demucs_available\\":false}");\n',
      );
      chmodSync(join(bin, 'uv'), 0o755);
      writeFileSync(
        runner,
        'import fs from "node:fs";\n' +
          'const [modulePath, folder, choice, callsPath, ...cli] = process.argv.slice(2);\n' +
          'const {runCommandFromArgv} = await import(modulePath);\n' +
          'const calls = [];\n' +
          'const after = (args, flag) => args[args.indexOf(flag) + 1];\n' +
          'const runCommandImpl = (_label, _command, args) => {\n' +
          '  calls.push(args);\n' +
          '  if (args.includes("tsuzuri-analyze")) { fs.mkdirSync(new URL(`file://${after(args, "-o")}`).pathname.replace(/\\/[^/]+$/, ""), {recursive:true}); fs.writeFileSync(after(args, "-o"), "{\\"version\\":1}"); fs.writeFileSync(after(args, "--lyrics-output"), "{\\"version\\":1,\\"segments\\":[]}"); }\n' +
          '  if (args.includes("tsuzuri-plan")) { const out = after(args, "-o"); fs.mkdirSync(new URL(`file://${out}`).pathname.replace(/\\/[^/]+$/, ""), {recursive:true}); fs.writeFileSync(out, JSON.stringify({meta:{version:1,duration:24,audio:"./song.mp3",width:1920,height:1080,fps:60,background:"#FFFFFF",photo_scale:0.8,trim:{mode:"auto",applied:true,full_duration:60,trimmed_duration:24}},photos:[{src:"./photo.jpg",start:0,end:24},{kind:"chapter",text:"第2天",start:2,end:4,src:"./chapter.jpg"},{kind:"future",src:"./future.jpg"}],subtitles:[]})); fs.writeFileSync(after(args, "--status-output"), JSON.stringify({outcome:"generated"})); }\n' +
          '  return args.includes("render.mjs") ? 1 : 0;\n' +
          '};\n' +
          'try { await runCommandFromArgv([folder, ...cli], {trimInteractive: choice !== "none", trimPromptRunner: async (run) => run({pick: async () => ({index: choice === "full" ? 1 : 0})}), runCommandImpl}); } catch (error) { calls.push(["error", error.message]); }\n' +
          'fs.writeFileSync(callsPath, JSON.stringify(calls));\n',
      );
      const script = fileURLToPath(new URL('./tsuzuri.mjs', import.meta.url));
      const run = ({name, toml, preference, cli = [], choice = 'none'}) => {
        const album = join(root, name);
        mkdirSync(album);
        writeFileSync(join(album, 'photo.jpg'), 'photo');
        writeFileSync(join(album, 'song.mp3'), 'audio');
        if (toml) writeFileSync(join(album, 'tsuzuri.toml'), toml);
        if (preference) {
          mkdirSync(join(album, 'output', 'metadata'), {recursive: true});
          writeFileSync(join(album, 'output', 'metadata', 'preferences.json'), JSON.stringify({version: 1, trim: preference}));
        }
        const result = spawnSync(process.execPath, [runner, script, album, choice, callsPath, ...cli], {
          encoding: 'utf8', env: {...process.env, PATH: `${bin}${delimiter}${process.env.PATH ?? ''}`},
        });
        assert.equal(result.status, 0, result.stderr);
        const calls = JSON.parse(readFileSync(callsPath, 'utf8'));
        assert.ok(calls.some((args) => args.includes('tsuzuri-plan')), JSON.stringify(calls));
        return {plannerCalls: calls.filter((args) => args.includes('tsuzuri-plan')), stdout: result.stdout};
      };
      const trimArg = (args) => args.includes('--trim') ? args[args.indexOf('--trim') + 1] : null;

      assert.deepEqual(run({name: 'default'}).plannerCalls.map(trimArg), [null]);
      assert.deepEqual(run({name: 'preference', preference: 'full'}).plannerCalls.map(trimArg), ['full']);
      assert.deepEqual(run({name: 'toml', toml: 'trim = "full"\n', preference: 'auto'}).plannerCalls.map(trimArg), [null]);
      assert.deepEqual(run({name: 'cli', toml: 'trim = "full"\n', preference: 'full', cli: ['--trim', 'auto']}).plannerCalls.map(trimArg), ['auto']);
      assert.deepEqual(run({name: 'accept-auto', choice: 'auto'}).plannerCalls.map(trimArg), [null]);
      const full = run({name: 'choose-full', choice: 'full'});
      assert.deepEqual(full.plannerCalls.map(trimArg), [null, 'full']);
      assert.match(full.stdout, /照片: 1 张,平均每张 24\.0s/);
      assert.match(full.stdout, /└ 已按完整歌曲重新规划/);
      assert.match(full.stdout, /● 已记住你的选择/);
      assert.doesNotMatch(full.stdout, /按裁剪选择重新规划照片时间线/);
      assert.equal(existsSync(join(root, 'accept-auto', 'tsuzuri.toml')), false);
      assert.equal(existsSync(join(root, 'choose-full', 'tsuzuri.toml')), false);
    } finally {
      rmSync(root, {recursive: true, force: true});
    }
  },
);
