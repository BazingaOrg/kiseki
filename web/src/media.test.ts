import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

import {LIGHTBOX_PREVIEW_WIDTH, lightboxSlide, mediaUrl, thumbUrl} from './media.ts';

test('lightbox slides use the 1024 preview, not the original file', () => {
  const slide = lightboxSlide('/album/DSC_0001.jpg');
  assert.equal(LIGHTBOX_PREVIEW_WIDTH, 1024);
  assert.equal(slide.src, thumbUrl('/album/DSC_0001.jpg', 1024));
  assert.equal(slide.photoPath, '/album/DSC_0001.jpg');
  assert.notEqual(slide.src, mediaUrl('/album/DSC_0001.jpg'));
});

test('photo grid loads the lightbox on demand and only preloads one neighbor', async () => {
  const grid = await readFile(new URL('./PhotoGrid.tsx', import.meta.url), 'utf8');
  const lightbox = await readFile(new URL('./PhotoLightbox.tsx', import.meta.url), 'utf8');
  assert.match(grid, /lazy\(\(\) => import\('\.\/PhotoLightbox'\)\)/);
  assert.match(lightbox, /preload: 1/);
  assert.match(lightbox, /lightboxSlide/);
  assert.doesNotMatch(lightbox, /mediaUrl/);
});
