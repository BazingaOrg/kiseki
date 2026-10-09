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
  const css = await readFile(new URL('./App.css', import.meta.url), 'utf8');
  assert.match(grid, /lazy\(\(\) => import\('\.\/PhotoLightbox'\)\)/);
  assert.match(lightbox, /preload: 1/);
  assert.match(lightbox, /lightboxSlide/);
  assert.doesNotMatch(lightbox, /mediaUrl/);
  assert.match(lightbox, /className="kiseki-lightbox-footer"/);
  assert.match(css, /\.kiseki-lightbox-footer\s*\{[^}]*position: absolute;/s);
});

test('photo caption blockers are visible and describe the disabled action', async () => {
  const grid = await readFile(new URL('./PhotoGrid.tsx', import.meta.url), 'utf8');
  assert.match(grid, /aria-describedby=\{!captionEnabled \? captionDescriptionId : undefined\}/);
  assert.match(grid, /<p className="hint photo-caption-blocked" id=\{captionDescriptionId\}>/);
});

test('photo controls expose one chronological toggle and no photo rename path', async () => {
  const grid = await readFile(new URL('./PhotoGrid.tsx', import.meta.url), 'utf8');
  const sort = await readFile(new URL('./photo-sort.ts', import.meta.url), 'utf8');
  const css = await readFile(new URL('./App.css', import.meta.url), 'utf8');
  assert.match(grid, /拍摄时间 · \{PHOTO_SORT_LABELS\[sort\]\}/);
  assert.match(grid, /点击切换为\$\{PHOTO_SORT_LABELS\[togglePhotoSort\(sort\)\]\}/);
  assert.match(grid, /Columns3 className="photo-layout-icon"/);
  assert.match(grid, /LayoutGrid className="photo-layout-icon"/);
  assert.doesNotMatch(grid, /aria-label=\{`改名/);
  assert.doesNotMatch(sort, /PHOTO_SORT_OPTIONS/);
  assert.doesNotMatch(sort, /label: '文件名'/);
  assert.match(css, /\.photo-item-meta\s*\{[^}]*grid-template-columns: minmax\(0, 1fr\) auto;/s);
  assert.match(css, /\.photo-item-caption-wrap,\s*\.photo-item-caption-editor\s*\{[^}]*grid-column: 1 \/ -1;/s);
  assert.match(css, /\.photo-item-name\s*\{[^}]*white-space: nowrap;/s);
  assert.match(css, /content: attr\(data-tooltip\)/);
  assert.match(css, /\.photo-item-name-wrap\[data-tooltip\]::after,[\s\S]*background: var\(--color-background\);/);
  assert.match(css, /box-shadow: 0 8px 24px rgba\(24, 22, 18, 0\.08\)/);
});

test('make output uses tabs and the filter select has a project-styled wrapper', async () => {
  const make = await readFile(new URL('./Make.tsx', import.meta.url), 'utf8');
  const css = await readFile(new URL('./App.css', import.meta.url), 'utf8');
  assert.match(make, /role="tablist" aria-label="输出方式"/);
  assert.match(make, /role="tabpanel" aria-labelledby=\{`make-output-tab-\$\{selectedTab\.kind\}`\}/);
  assert.match(make, /className="make-filter-picker"/);
  assert.match(make, /role="listbox" aria-label="滤镜选项"/);
  assert.match(make, /const \[expanded, setExpanded\] = useState\(true\)/);
  assert.match(make, /setMenuPlacement\(placeTop \? 'top' : 'bottom'\)/);
  assert.match(make, /className=\{`make-filter-menu make-filter-menu-\$\{menuPlacement\}`\}/);
  assert.doesNotMatch(make, /输出倍率/);
  assert.match(css, /\.make-filter-picker\s*\{/);
  assert.match(css, /\.make-filter-option\s*\{/);
  assert.match(css, /\.make-filter-menu-top\s*\{/);
});

test('theme mode has system, light and dark choices with a restrained transition', async () => {
  const toggle = await readFile(new URL('./ThemeToggle.tsx', import.meta.url), 'utf8');
  const theme = await readFile(new URL('./theme.ts', import.meta.url), 'utf8');
  const css = await readFile(new URL('./App.css', import.meta.url), 'utf8');
  assert.match(toggle, /系统/);
  assert.match(toggle, /白天/);
  assert.match(toggle, /黑夜/);
  assert.match(toggle, /role="group" aria-label="主题模式"/);
  assert.match(toggle, /aria-pressed=\{optionMode === mode\}/);
  assert.match(theme, /THEME_MODE_KEY/);
  assert.match(css, /html\[data-theme-transition\] body/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});

test('results stills can offer a bulk delete action', async () => {
  const grid = await readFile(new URL('./PhotoGrid.tsx', import.meta.url), 'utf8');
  const results = await readFile(new URL('./Results.tsx', import.meta.url), 'utf8');
  const make = await readFile(new URL('./Make.tsx', import.meta.url), 'utf8');
  assert.match(grid, /onDeleteAll/);
  assert.match(grid, /全部删除/);
  assert.match(results, /onDeleteAll/);
  assert.match(make, /图片旁白/);
  assert.match(make, /STILL_DEFAULTS/);
  assert.match(make, /photoCaption: false/);
});
