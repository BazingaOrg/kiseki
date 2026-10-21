import assert from 'node:assert/strict';
import test from 'node:test';

import {resolveOutputVariantSuffix, resolveRenderOutputPath} from './output-naming.mjs';

test('render output resolver preserves explicit paths and composes every default variant suffix', () => {
  const options = {
    folder: '/tmp/summer-album', exif: true, sign: true, dark: true,
    portrait: true, draft: true,
  };
  assert.equal(
    resolveRenderOutputPath(options),
    '/tmp/summer-album/output/summer-album-exif-sign-dark-portrait-draft.mp4',
  );
  assert.equal(resolveRenderOutputPath({...options, output: './film.mp4'}), `${process.cwd()}/film.mp4`);
});

test('template appends a suffix so re-rendering with another template cannot overwrite the previous cut', () => {
  assert.equal(
    resolveRenderOutputPath({folder: '/tmp/summer-album', template: 'slow-cinema'}),
    '/tmp/summer-album/output/summer-album-template-slow-cinema.mp4',
  );
  assert.equal(
    resolveRenderOutputPath({folder: '/tmp/summer-album', draft: true, template: 'news-cut'}),
    '/tmp/summer-album/output/summer-album-draft-template-news-cut.mp4',
  );
  // 显式 -o 依旧优先,模板不进文件名
  assert.equal(
    resolveRenderOutputPath({folder: '/tmp/summer-album', template: 'polaroid', output: './final.mp4'}),
    `${process.cwd()}/final.mp4`,
  );
});

test('still 调用不传 template,输出名不带模板后缀(模板是渲染专用)', () => {
  assert.equal(
    resolveOutputVariantSuffix({sign: true}),
    '-sign',
  );
});

test('caption suffix sits after sign and before dark', () => {
  assert.equal(resolveOutputVariantSuffix({photoCaption: true}), '-caption');
  assert.equal(
    resolveOutputVariantSuffix({exif: true, sign: true, photoCaption: true, dark: true, portrait: true}),
    '-exif-sign-caption-dark-portrait',
  );
});
