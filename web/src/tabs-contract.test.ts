import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const source = (name: string) => readFile(new URL(`./${name}`, import.meta.url), 'utf8');

test('materials panels remain mounted and results keeps its audio node outside tab branches', async () => {
  const [materials, results] = await Promise.all([source('Materials.tsx'), source('Results.tsx')]);
  assert.equal((materials.match(/getPanelProps\('(photos|music|lyrics)'\)/g) ?? []).length, 3);
  assert.match(results, /<audio \{\.\.\.audioProps\} \/>/);
  assert.equal((results.match(/getPanelProps\('(videos|music|photos)'\)/g) ?? []).length, 3);
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

test('internal recovery retry keeps its dialog open until recovery succeeds', async () => {
  const workbench = await source('Workbench.tsx');
  assert.match(workbench, /const recoveryUndoId = result\.recoveryUndoId \?\? undoId/);
  assert.match(workbench, /confirmLabel: '再次尝试恢复'/);
  assert.match(workbench, /if \(await handleRecovery\(recoveryUndoId\)\) setDialog\(null\)/);
  assert.doesNotMatch(workbench, /asset-undo|>撤销</);
});

test('narrow topbar and media status rules preserve truncation and status visibility', async () => {
  const css = await source('App.css');
  assert.match(css, /\.folder-switch-name\s*\{[^}]*overflow: hidden;[^}]*text-overflow: ellipsis;[^}]*white-space: nowrap;/s);
  assert.match(css, /@media \(max-width: 640px\)\s*\{[\s\S]*?\.topbar\s*\{[^}]*grid-template-columns: minmax\(0, 1fr\) auto;/);
  assert.match(css, /\.audio-bar \.media-buffering,[\s\S]*?\.audio-bar \.media-error\s*\{[^}]*order: 3;/);
});
