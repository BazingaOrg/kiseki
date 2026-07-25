/**
 * 门禁矩阵的回归测试。UI 里每一个 disabled 都源自这里,所以这份表要盯死:
 * 少一条依赖 = 用户点了必然失败的按钮,多一条 = 明明能做却被灰掉。
 *
 * 跑法与 renderer 一致:node --experimental-strip-types --test src/capabilities.test.ts
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {deriveCapabilities} from './capabilities.ts';
import type {CapabilityId} from './capabilities.ts';
import type {DoctorResponse, DoctorState, ProjectResponse} from './types.ts';

const ALL_DEPS_OK: DoctorResponse = {
  ok: true,
  checks: ['node', 'uv', 'ffmpeg', 'renderer', 'yt-dlp', 'analyzer'].map((id) => ({
    id,
    ok: true,
    optional: id === 'yt-dlp' || id === 'analyzer',
    line: `${id} ok`,
    fix: null,
  })),
};

const withMissingDep = (missing: string): DoctorResponse => ({
  ok: false,
  checks: ALL_DEPS_OK.checks.map((check) =>
    check.id === missing ? {...check, ok: false, fix: `装一下 ${missing}`} : check,
  ),
});

const emptyProject: ProjectResponse = {
  path: '/tmp/trip',
  name: 'trip',
  photos: [],
  audio: null,
  audioCount: 0,
  lyricsFile: null,
  lyricsCount: 0,
  lyrics: null,
  lyricsSource: null,
  recognizedLyricsPath: null,
  timelinePath: null,
  unsupportedVideos: [],
  filterConfig: null,
  output: {stills: [], videos: []},
};

const fullProject: ProjectResponse = {
  ...emptyProject,
  photos: ['/tmp/trip/a.jpg', '/tmp/trip/b.jpg'],
  audio: '/tmp/trip/audio/music.mp3',
  audioCount: 1,
  lyricsFile: '/tmp/trip/audio/music.lrc',
  lyricsCount: 1,
  lyrics: [{time: 0, text: 'hello'}],
  lyricsSource: 'lrc',
  output: {stills: ['/tmp/trip/output/stills/a.png'], videos: ['/tmp/trip/output/trip.mp4']},
};

const enabledSet = (project: ProjectResponse | null, doctor: DoctorState): Set<string> => {
  const caps = deriveCapabilities(project, doctor);
  return new Set(Object.keys(caps).filter((id) => caps[id as CapabilityId].enabled));
};

test('nothing is available before a folder is chosen', () => {
  const caps = deriveCapabilities(null, ALL_DEPS_OK);
  for (const [id, capability] of Object.entries(caps)) {
    assert.equal(capability.enabled, false, `${id} 不该在未选素材夹时可用`);
    assert.equal(capability.blockers[0].reason, '还没有选素材夹。');
  }
});

test('a complete project with all deps unlocks everything', () => {
  const caps = deriveCapabilities(fullProject, ALL_DEPS_OK);
  for (const [id, capability] of Object.entries(caps)) {
    assert.equal(capability.enabled, true, `${id} 应当可用,却被 ${JSON.stringify(capability.blockers)} 挡住`);
  }
});

test('an empty folder only leaves the actions that need nothing', () => {
  // 空文件夹里唯一还能做的是在线找音频(只要 yt-dlp 在)
  assert.deepEqual(enabledSet(emptyProject, ALL_DEPS_OK), new Set(['fetchAudio']));
});

test('photos but no audio: stills yes, video no', () => {
  const project = {...emptyProject, photos: ['/tmp/trip/a.jpg']};
  const caps = deriveCapabilities(project, ALL_DEPS_OK);
  assert.equal(caps.exportStill.enabled, true);
  assert.equal(caps.renderVideo.enabled, false);
  assert.equal(caps.browsePhotos.enabled, true);
  assert.equal(caps.renderVideo.blockers[0].reason, '还差一首歌。');
});

test('audio but no photos: lyrics work, neither render nor still does', () => {
  const project = {...emptyProject, audio: '/tmp/trip/music.mp3', audioCount: 1};
  const caps = deriveCapabilities(project, ALL_DEPS_OK);
  assert.equal(caps.recognizeLyrics.enabled, true);
  assert.equal(caps.fetchLyrics.enabled, true);
  assert.equal(caps.exportStill.enabled, false);
  assert.equal(caps.renderVideo.enabled, false);
});

test('fetching lyrics needs audio to match against', () => {
  const caps = deriveCapabilities(emptyProject, ALL_DEPS_OK);
  assert.equal(caps.fetchLyrics.enabled, false);
  assert.match(caps.fetchLyrics.blockers[0].reason, /要先有音频/);
});

test('recognized lyrics unlock follow-along without any .lrc', () => {
  // 后端在没有 .lrc 时把 output/metadata/lyrics.json 的 segments 归一成同一个数组
  const project: ProjectResponse = {
    ...emptyProject,
    audio: '/tmp/trip/music.mp3',
    audioCount: 1,
    lyrics: [{time: 1.2, text: 'recognized line'}],
    lyricsSource: 'recognized',
    recognizedLyricsPath: '/tmp/trip/output/metadata/lyrics.json',
  };
  assert.equal(deriveCapabilities(project, ALL_DEPS_OK).followLyrics.enabled, true);
});

test('an empty recognition result (instrumental) still blocks follow-along', () => {
  const project: ProjectResponse = {
    ...emptyProject,
    audio: '/tmp/trip/music.mp3',
    audioCount: 1,
    recognizedLyricsPath: '/tmp/trip/output/metadata/lyrics.json',
  };
  assert.equal(deriveCapabilities(project, ALL_DEPS_OK).followLyrics.enabled, false);
});

test('two audio files are caught before the CLI would error out', () => {
  const project = {...fullProject, audioCount: 2};
  const caps = deriveCapabilities(project, ALL_DEPS_OK);
  assert.equal(caps.renderVideo.enabled, false);
  assert.match(caps.renderVideo.blockers.map((b) => b.reason).join(' '), /只能留一份/);
});

test('missing ffmpeg blocks rendering but not still export', () => {
  const caps = deriveCapabilities(fullProject, withMissingDep('ffmpeg'));
  assert.equal(caps.renderVideo.enabled, false);
  assert.equal(caps.exportStill.enabled, true);
});

test('missing renderer blocks both render and still', () => {
  const caps = deriveCapabilities(fullProject, withMissingDep('renderer'));
  assert.equal(caps.renderVideo.enabled, false);
  assert.equal(caps.exportStill.enabled, false);
});

test('missing uv blocks render and lyric recognition, not playback', () => {
  const caps = deriveCapabilities(fullProject, withMissingDep('uv'));
  assert.equal(caps.renderVideo.enabled, false);
  assert.equal(caps.recognizeLyrics.enabled, false);
  assert.equal(caps.playVideo.enabled, true);
  assert.equal(caps.followLyrics.enabled, true);
});

test('missing yt-dlp only blocks fetching audio', () => {
  const caps = deriveCapabilities(fullProject, withMissingDep('yt-dlp'));
  assert.equal(caps.fetchAudio.enabled, false);
  assert.equal(caps.fetchLyrics.enabled, true);
  assert.equal(caps.renderVideo.enabled, true);
});

test('all blockers are reported, not just the first one', () => {
  const caps = deriveCapabilities(emptyProject, withMissingDep('ffmpeg'));
  const reasons = caps.renderVideo.blockers.map((blocker) => blocker.reason);
  assert.ok(reasons.length >= 3, `期望同时报出缺照片/缺音频/缺 ffmpeg,实际: ${reasons.join(' | ')}`);
});

test('while doctor is still loading, dependency blockers are withheld', () => {
  // 环境状态没回来之前不该把渲染判死 —— 那只是还没查完,不是真的缺依赖
  const caps = deriveCapabilities(fullProject, 'loading');
  assert.equal(caps.renderVideo.enabled, true);
  assert.equal(caps.fetchAudio.enabled, true);
});

test('an unavailable doctor blocks anything with a dependency', () => {
  // 查不到环境时绝不能继续声称"素材齐了，可以开工" —— 那台机器可能根本没装 ffmpeg
  const caps = deriveCapabilities(fullProject, 'unavailable');
  assert.equal(caps.renderVideo.enabled, false);
  assert.equal(caps.exportStill.enabled, false);
  assert.equal(caps.recognizeLyrics.enabled, false);
  assert.equal(caps.fetchAudio.enabled, false);
  // 不依赖外部程序的能力照旧可用
  assert.equal(caps.playVideo.enabled, true);
  assert.equal(caps.followLyrics.enabled, true);
  assert.equal(caps.browsePhotos.enabled, true);
});

test('the unavailable-doctor reason is only stated once per capability', () => {
  // renderVideo 依赖 uv + ffmpeg + renderer 三项,不该把同一句话重复三遍
  const blockers = deriveCapabilities(fullProject, 'unavailable').renderVideo.blockers;
  assert.equal(blockers.length, 1);
});

test('recognizing lyrics needs ffmpeg, because analyzer falls back to it for m4a', () => {
  const caps = deriveCapabilities(fullProject, withMissingDep('ffmpeg'));
  assert.equal(caps.recognizeLyrics.enabled, false);
});

test('every blocker either offers a remedy or is the no-folder case', () => {
  for (const doctor of [ALL_DEPS_OK, withMissingDep('ffmpeg'), withMissingDep('renderer')]) {
    for (const project of [emptyProject, fullProject]) {
      for (const capability of Object.values(deriveCapabilities(project, doctor))) {
        for (const blocker of capability.blockers) {
          assert.notEqual(blocker.remedy, null, `"${blocker.reason}" 没有给出补齐入口`);
        }
      }
    }
  }
});
