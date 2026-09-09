import assert from 'node:assert/strict';
import test from 'node:test';

import {fitStillCaption, fitTopCaption, measureCaptionWidth} from './photo-caption-fit.mjs';

test('fitTopCaption uses injected measureWidth instead of a CJK estimate', async () => {
  const calls = [];
  const layout = await fitTopCaption({
    text: '坐得端正，也不耽误心里走神',
    canvasWidth: 1920,
    canvasHeight: 1080,
    photoScale: 0.8,
    imageWidth: 640,
    imageHeight: 480,
    visualScale: 1,
    measureWidth: async (args) => {
      calls.push(args);
      return 400;
    },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].text, '坐得端正，也不耽误心里走神');
  assert.ok(calls[0].fontSize > 0);
  assert.ok(layout);
  assert.equal(layout.fontSize, 32);
});

test('fitTopCaption returns null when measured width cannot fit the band', async () => {
  const layout = await fitTopCaption({
    text: '这句太长了所以排不进去',
    canvasWidth: 1920,
    canvasHeight: 1080,
    photoScale: 1,
    imageWidth: 1920,
    imageHeight: 1080,
    visualScale: 1,
    measureWidth: async () => 4000,
  });
  assert.equal(layout, null);
});

test('fitStillCaption returns null when the photo leaves no top band', async () => {
  const layout = await fitStillCaption({
    text: '签名上方空间不够',
    canvasWidth: 1920,
    canvasHeight: 400,
    photoScale: 1,
    imageWidth: 1920,
    imageHeight: 400,
    visualScale: 1,
    hasExif: false,
    sign: false,
    measureWidth: async () => 200,
  });
  assert.equal(layout, null);
});

test('captionPageFromBrowser opens a dedicated Remotion page', async () => {
  const {captionPageFromBrowser} = await import('./photo-caption-fit.mjs');
  let newPageArgs = null;
  let gotoArgs = null;
  const page = {goto: async (args) => { gotoArgs = args; }};
  const browser = {
    newPage: async (args) => {
      newPageArgs = args;
      return page;
    },
  };
  const opened = await captionPageFromBrowser(browser, 'http://bundle');
  assert.equal(opened, page);
  assert.equal(typeof newPageArgs.context, 'function');
  assert.equal(newPageArgs.logLevel, 'error');
  assert.deepEqual(gotoArgs, {url: 'about:blank', timeout: 10_000});
});

test('measureCaptionWidth requires a browser page', async () => {
  await assert.rejects(() => measureCaptionWidth(null, {
    text: 'x',
    fontFamily: 'serif',
    fontSize: 32,
    fontWeight: 400,
    letterSpacing: '0.08em',
  }), /caption-measure-unavailable/);
});
