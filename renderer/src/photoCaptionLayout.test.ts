import assert from 'node:assert/strict';
import test from 'node:test';

import {
  chooseFontSize,
  containSize,
  layoutStillCaption,
  layoutTopBandCaption,
  polaroidMaxRotation,
  rotatedBounds,
  stillCaptionMetrics,
  STILL_SIGNATURE_BOTTOM_INSET,
  STILL_SIGNATURE_HEIGHT,
  videoSubjectTop,
} from './photoCaptionLayout.mjs';

test('top band returns null when the photo already fills the canvas', () => {
  assert.equal(
    layoutTopBandCaption({
      canvasWidth: 1920,
      canvasHeight: 1080,
      visualScale: 1,
      subjectTop: 0,
      maxTextWidth: 1600,
      measuredAtMax: 400,
      codePoints: 10,
    }),
    null,
  );
});

test('font size scales down but never below 24px at 1080p', () => {
  assert.equal(chooseFontSize({measuredAtMax: 400, maxWidth: 800, visualScale: 1}), 32);
  assert.ok((chooseFontSize({measuredAtMax: 2000, maxWidth: 1600, visualScale: 1}) ?? 0) >= 24);
  assert.equal(chooseFontSize({measuredAtMax: 4000, maxWidth: 200, visualScale: 1}), null);
});

test('rotated polaroid bounds expand the axis-aligned box', () => {
  const box = rotatedBounds(100, 50, 90);
  assert.ok(Math.abs(box.width - 50) < 1e-6);
  assert.ok(Math.abs(box.height - 100) < 1e-6);
});

test('contain keeps aspect ratio', () => {
  assert.deepEqual(containSize(200, 100, 100, 100), {width: 100, height: 50});
});

test('polaroid subject top accounts for padded rotated card', () => {
  const args = {
    canvasWidth: 1920,
    canvasHeight: 1080,
    photoScale: 0.8,
    imageWidth: 640,
    imageHeight: 480,
    src: 'photos/001.jpg',
  };
  const plain = videoSubjectTop(args);
  const polaroid = videoSubjectTop({...args, templateId: 'polaroid'});
  assert.ok(polaroid < plain, 'rotated card occupies more vertical space');
  assert.ok(polaroidMaxRotation(args.src) >= 10);
});

test('slow-cinema zoom lifts the subject top', () => {
  const args = {
    canvasWidth: 1920,
    canvasHeight: 1080,
    photoScale: 0.8,
    imageWidth: 640,
    imageHeight: 480,
  };
  const still = videoSubjectTop(args);
  const zoomed = videoSubjectTop({...args, motionZoom: 1.06});
  assert.ok(zoomed < still);
});

test('still metrics place the signature at bottomInset + height', () => {
  const metrics = stillCaptionMetrics({
    canvasWidth: 1920,
    canvasHeight: 1080,
    visualScale: 1,
    photoScale: 0.8,
    imageWidth: 640,
    imageHeight: 480,
    hasExif: false,
    sign: true,
  });
  assert.equal(metrics.signTop, 1080 - (STILL_SIGNATURE_BOTTOM_INSET + STILL_SIGNATURE_HEIGHT));
  assert.ok(metrics.lift > 0);
  const layout = layoutStillCaption({
    canvasWidth: 1920,
    canvasHeight: 1080,
    visualScale: 1,
    photoBox: metrics.photoBox,
    maxTextWidth: 400,
    measuredAtMax: 200,
    codePoints: 8,
    signTop: metrics.signTop,
  });
  assert.ok(layout);
  assert.ok(layout.y >= metrics.photoBox.y + metrics.photoBox.height);
});
