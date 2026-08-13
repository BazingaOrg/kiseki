import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const source = (name: string) => readFile(new URL(`./${name}`, import.meta.url), 'utf8');

test('materials panels remain mounted and results contains output panels only', async () => {
  const [materials, results] = await Promise.all([source('Materials.tsx'), source('Results.tsx')]);
  assert.equal((materials.match(/getPanelProps\('(photos|music|lyrics)'\)/g) ?? []).length, 3);
  assert.doesNotMatch(results, /getPanelProps\('music'\)|<audio/);
  assert.equal((results.match(/getPanelProps\('(videos|photos)'\)/g) ?? []).length, 2);
});

test('a single video uses compact metadata while multiple videos keep the playlist', async () => {
  const [results, css] = await Promise.all([source('Results.tsx'), source('App.css')]);
  assert.match(results, /const hasVideoPlaylist = videoAssets\.items\.length > 1/);
  assert.match(results, /hasVideoPlaylist \? 'result-video result-video-with-playlist' : 'result-video result-video-single'/);
  assert.match(css, /\.result-video-single-file/);
});

test('recognized lyric preview exposes replace and clear actions only through callbacks', async () => {
  const materials = await source('Materials.tsx');
  assert.match(materials, /project\.lyricsSource === 'recognized'/);
  assert.match(materials, /重新识别/);
  assert.match(materials, /清除识别结果/);
  assert.match(materials, /onReplaceRecognizedLyrics/);
  assert.match(materials, /onClearRecognizedLyrics/);
  assert.match(materials, /disabled=\{locked \|\| assetBusy \|\| running\}/);
  assert.match(materials, /activeKind === 'lyrics' && job\.status !== 'idle'/);
  assert.match(materials, /<JobPanel verb="识别"/);
});

test('lyrics empty state prioritizes online matching before local recognition', async () => {
  const [materials, css] = await Promise.all([source('Materials.tsx'), source('App.css')]);
  assert.match(materials, /className="fetch lyrics-empty-state"/);
  assert.match(materials, /<h3>还没有歌词<\/h3>/);
  assert.match(materials, /可以先在线匹配；没有合适版本时，再使用本地人声识别。/);
  assert.match(materials, /className="lyrics-online-match"/);
  assert.ok(materials.indexOf('className="lyrics-online-match"') < materials.indexOf('className="lyrics-local-recognition"'));
  assert.match(materials, /className="lyrics-recognition-action"[\s\S]*?本地识别[\s\S]*?FieldHelp[\s\S]*?capabilities\.recognizeLyrics\.enabled/);
  assert.doesNotMatch(materials, /fetch-paths|fetch-path/);
  assert.doesNotMatch(css, /fetch-paths|fetch-path/);
  assert.doesNotMatch(css, /lyrics-online-match > \.fetch/);
  assert.match(materials, /<LyricsSearch project=\{project\} locked=\{locked\} onDone=\{onRefresh\} \/>/);
  assert.match(materials, /onClick=\{\(\) => onStart\(\{kind: 'lyrics'\}\)\}/);
});

test('internal recovery retry keeps its dialog open until recovery succeeds', async () => {
  const workbench = await source('Workbench.tsx');
  assert.match(workbench, /const recoveryUndoId = result\.recoveryUndoId \?\? undoId/);
  assert.match(workbench, /confirmLabel: '再次尝试恢复'/);
  assert.match(workbench, /if \(await handleRecovery\(recoveryUndoId\)\) setDialog\(null\)/);
  assert.doesNotMatch(workbench, /asset-undo|>撤销</);
});

test('only an immutable sandbox locks project switching', async () => {
  const workbench = await source('Workbench.tsx');
  assert.match(workbench, /const locked = projectSelection === 'sandbox' && project\.root === project\.path/);
});

test('narrow topbar and media status rules preserve truncation and status visibility', async () => {
  const css = await source('App.css');
  assert.match(css, /\.folder-switch-name\s*\{[^}]*overflow: hidden;[^}]*text-overflow: ellipsis;[^}]*white-space: nowrap;/s);
  assert.match(css, /@media \(max-width: 640px\)\s*\{[\s\S]*?\.topbar\s*\{[^}]*grid-template-columns: minmax\(0, 1fr\) auto;/);
  assert.match(css, /\.audio-bar \.media-buffering,[\s\S]*?\.audio-bar \.media-error\s*\{[^}]*order: 3;/);
});

test('video waits for a decoded frame and keeps the media stage at the source aspect ratio', async () => {
  const [player, mediaPlayer, css] = await Promise.all([source('Player.tsx'), source('useMediaPlayer.ts'), source('App.css')]);
  assert.match(player, /loadedVideo === video/);
  assert.match(player, /onLoadedData=\{handleLoadedData\}/);
  assert.match(player, /--player-video-aspect-ratio/);
  assert.match(mediaPlayer, /case 'loadeddata':/);
  assert.match(css, /\.player-media-stage\s*\{[^}]*aspect-ratio: var\(--player-video-aspect-ratio\);/s);
  assert.match(css, /\.player-video\s*\{[^}]*background: transparent;[^}]*opacity: 0;/s);
  assert.match(css, /\.player-video-ready\s*\{[^}]*opacity: 1;/s);
});

test('desktop chrome keeps safe drag regions and fullscreen media controls clear of window edges', async () => {
  const [main, player, css] = await Promise.all([source('main.tsx'), source('Player.tsx'), source('App.css')]);
  assert.match(main, /document\.documentElement\.classList\.add\('desktop-shell'\)/);
  assert.match(css, /\.desktop-shell \.topbar\s*\{[^}]*padding-left: 5\.75rem;[^}]*-webkit-app-region: drag;/s);
  assert.match(css, /\.desktop-shell \.welcome\s*\{[^}]*-webkit-app-region: drag;/s);
  assert.match(css, /\.desktop-shell \.kiseki-lightbox \.yarl__toolbar\s*\{[^}]*top: max\(48px,/s);
  assert.match(css, /\.kiseki-lightbox \.yarl__navigation_prev\s*\{[^}]*left: max\(24px,/s);
  assert.match(player, /controlsTimerRef/);
  assert.match(player, /onPointerMove=\{revealControls\}/);
  assert.match(player, /isFullscreen \? <Minimize/);
  assert.doesNotMatch(player, /className="player-shortcuts"/);
  assert.match(css, /\.player:fullscreen\.player-controls-hidden \.video-controls/);
  assert.match(css, /background: rgba\(250, 248, 243, 0\.88\)/);
});
