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

test('narrow topbar and media status rules preserve truncation and status visibility', async () => {
  const css = await source('App.css');
  assert.match(css, /\.folder-switch-name\s*\{[^}]*overflow: hidden;[^}]*text-overflow: ellipsis;[^}]*white-space: nowrap;/s);
  assert.match(css, /@media \(max-width: 640px\)\s*\{[\s\S]*?\.topbar\s*\{[^}]*grid-template-columns: minmax\(0, 1fr\) auto;/);
  assert.match(css, /\.audio-bar \.media-buffering,[\s\S]*?\.audio-bar \.media-error\s*\{[^}]*order: 3;/);
});
