import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CAPTION_COMPACT_LETTER_SPACING,
  CAPTION_BAND_PAD,
  CAPTION_SUBJECT_GAP,
  CAPTION_FONT_WEIGHT,
  CAPTION_LETTER_SPACING,
  chooseFontSize,
  containSize,
  isCaptionLayout,
  layoutBelowSubjectCaption,
  layoutSafeCaption,
  layoutTopBandCaption,
  letterSpacingFor,
  resolveVideoPhotoScale,
  polaroidMaxRotation,
  rotatedBounds,
  stillCaptionMetrics,
  STILL_SIGNATURE_BOTTOM_INSET,
  STILL_SIGNATURE_HEIGHT,
  videoSubjectTop,
} from './photoCaptionLayout.mjs';

test('caption layout requires complete positive preflight geometry', () => {
  assert.equal(isCaptionLayout(null), false);
  assert.equal(isCaptionLayout({fontSize: 32}), false);
  assert.equal(isCaptionLayout({x: 0, y: 0, width: 900, height: 43.2, fontSize: 32, letterSpacing: '0.16em'}), true);
});

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

test('caption 题签 is lighter and more openly tracked than default body type', () => {
  assert.equal(CAPTION_FONT_WEIGHT, 300);
  assert.equal(letterSpacingFor(8), CAPTION_LETTER_SPACING);
  assert.equal(letterSpacingFor(19), CAPTION_COMPACT_LETTER_SPACING);
  assert.ok(CAPTION_LETTER_SPACING > CAPTION_COMPACT_LETTER_SPACING);
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
});

test('caption pins a fixed gap above the photo with or without EXIF', () => {
  for (const hasExif of [false, true]) {
    const metrics = stillCaptionMetrics({
      canvasWidth: 1920,
      canvasHeight: 1080,
      visualScale: 1,
      photoScale: 0.8,
      imageWidth: 640,
      imageHeight: 480,
      hasExif,
      sign: false,
      hasCaption: true,
    });
    const layout = layoutSafeCaption({
      canvasWidth: 1920,
      canvasHeight: 1080,
      visualScale: 1,
      maxTextWidth: 1600,
      measuredAtMax: 400,
      codePoints: 8,
      photoTop: metrics.photoBox.y,
      photoBottom: metrics.photoBox.y + metrics.photoBox.height,
    });
    assert.ok(layout);
    const above = metrics.photoBox.y - (layout.y + layout.height);
    const below = layout.y - (metrics.photoBox.y + metrics.photoBox.height);
    assert.ok(Math.abs(above - CAPTION_SUBJECT_GAP) < 1e-6 || Math.abs(below - CAPTION_SUBJECT_GAP) < 1e-6);
  }
});

test('no-EXIF signature lifts the photo so the bottom gap matches the caption gap', () => {
  const metrics = stillCaptionMetrics({
    canvasWidth: 1920,
    canvasHeight: 1080,
    visualScale: 1,
    photoScale: 0.8,
    imageWidth: 1920,
    imageHeight: 1080,
    hasExif: false,
    sign: true,
  });
  const photoBottom = metrics.photoBox.y + metrics.photoBox.height;
  assert.ok(metrics.lift > 0);
  assert.ok(metrics.signTop != null);
  assert.ok(metrics.signTop - photoBottom >= CAPTION_SUBJECT_GAP - 1e-6);
});

test('caption plus signature keeps the subject gap without extra photo lift', () => {
  const metrics = stillCaptionMetrics({
    canvasWidth: 1920,
    canvasHeight: 1080,
    visualScale: 1,
    photoScale: 0.8,
    imageWidth: 1920,
    imageHeight: 1080,
    hasExif: false,
    sign: true,
    hasCaption: true,
  });
  assert.equal(metrics.lift, 0);
  const layout = layoutSafeCaption({
    canvasWidth: 1920,
    canvasHeight: 1080,
    visualScale: 1,
    maxTextWidth: 1600,
    measuredAtMax: 400,
    codePoints: 8,
    photoTop: metrics.photoBox.y,
    photoBottom: metrics.photoBox.y + metrics.photoBox.height,
  });
  assert.ok(layout);
  const above = metrics.photoBox.y - (layout.y + layout.height);
  const below = layout.y - (metrics.photoBox.y + metrics.photoBox.height);
  assert.ok(Math.abs(above - CAPTION_SUBJECT_GAP) < 1e-6 || Math.abs(below - CAPTION_SUBJECT_GAP) < 1e-6);
});

test('EXIF stills do not lift the photo for a canvas signature', () => {
  const metrics = stillCaptionMetrics({
    canvasWidth: 1920,
    canvasHeight: 1080,
    visualScale: 1,
    photoScale: 0.8,
    imageWidth: 1920,
    imageHeight: 1080,
    hasExif: true,
    sign: true,
  });
  assert.equal(metrics.lift, 0);
  assert.equal(metrics.signTop, null);
});

test('portrait captions sit a comfortable gap above the photo, not the canvas edge', () => {
  const photoTop = videoSubjectTop({
    canvasWidth: 1080,
    canvasHeight: 1920,
    photoScale: 0.8,
    imageWidth: 640,
    imageHeight: 480,
  });
  const layout = layoutSafeCaption({
    canvasWidth: 1080,
    canvasHeight: 1920,
    visualScale: 1,
    maxTextWidth: 928.8,
    measuredAtMax: 400,
    codePoints: 10,
    photoTop,
  });
  assert.ok(layout);
  assert.ok(layout.y >= CAPTION_BAND_PAD);
  assert.equal(photoTop - (layout.y + layout.height), CAPTION_SUBJECT_GAP);
});

test('portrait 9:16 photos keep a top caption band at the default photo scale', () => {
  const layout = layoutTopBandCaption({
    canvasWidth: 1080,
    canvasHeight: 1920,
    visualScale: 1,
    subjectTop: videoSubjectTop({
      canvasWidth: 1080,
      canvasHeight: 1920,
      photoScale: 0.8,
      imageWidth: 1080,
      imageHeight: 1920,
    }),
    maxTextWidth: 928.8,
    measuredAtMax: 400,
    codePoints: 10,
  });
  assert.ok(layout);
  assert.ok(layout.y >= 24);
});

test('portrait captions fall back below the photo when the top band is gone', () => {
  const layout = layoutBelowSubjectCaption({
    canvasWidth: 1080,
    canvasHeight: 1920,
    visualScale: 1,
    subjectBottom: 1400,
    maxTextWidth: 900,
    measuredAtMax: 400,
    codePoints: 8,
  });
  assert.ok(layout);
  assert.equal(layout.x, (1080 - 900) / 2);
  assert.ok(layout.y > 1400);
});

test('caption layout skips when neither side of the subject is safe', () => {
  const layout = layoutSafeCaption({
    canvasWidth: 1080,
    canvasHeight: 1920,
    visualScale: 1,
    maxTextWidth: 900,
    measuredAtMax: 400,
    codePoints: 8,
    photoTop: 40,
    photoBottom: 1880,
  });
  assert.equal(layout, null);
});

test('common photo aspects keep the caption attached with the same gap on portrait stills', () => {
  const aspects = [
    [4, 3],
    [16, 9],
    [1, 1],
    [3, 4],
    [9, 16],
  ];
  for (const [w, h] of aspects) {
    const photoTop = videoSubjectTop({
      canvasWidth: 1080,
      canvasHeight: 1920,
      photoScale: 0.8,
      imageWidth: w * 100,
      imageHeight: h * 100,
    });
    const layout = layoutSafeCaption({
      canvasWidth: 1080,
      canvasHeight: 1920,
      visualScale: 1,
      maxTextWidth: 900,
      measuredAtMax: 360,
      codePoints: 8,
      photoTop,
      photoBottom: photoTop + containSize(w * 100, h * 100, 1080 * 0.8, 1920 * 0.8).height,
    });
    assert.ok(layout, `${w}:${h} should place a caption`);
    assert.ok(layout.y >= CAPTION_BAND_PAD, `${w}:${h} stays inside the top pad`);
    const aboveGap = photoTop - (layout.y + layout.height);
    const belowGap = layout.y - (photoTop + containSize(w * 100, h * 100, 1080 * 0.8, 1920 * 0.8).height);
    assert.ok(
      Math.abs(aboveGap - CAPTION_SUBJECT_GAP) < 1e-6 || Math.abs(belowGap - CAPTION_SUBJECT_GAP) < 1e-6,
      `${w}:${h} should sit ${CAPTION_SUBJECT_GAP}px from the photo`,
    );
  }
});

test('caption photo scale matches bilingual diary shrink and reserves a top band', () => {
  const bilingual = resolveVideoPhotoScale({
    photoScale: 0.85,
    canvasHeight: 1080,
    visualScale: 1,
    bilingual: true,
    fontSize: 44,
    riseDistance: 4,
  });
  assert.ok(bilingual < 0.85);
  const withCaption = resolveVideoPhotoScale({
    photoScale: 0.96,
    canvasHeight: 1920,
    visualScale: 1,
    hasCaption: true,
  });
  assert.ok(withCaption < 0.96);
  assert.ok((1920 * (1 - withCaption)) / 2 >= 130);
});

test('portrait signature reserve leaves a non-overlapping subtitle band', () => {
  const fitted = resolveVideoPhotoScale({
    photoScale: 0.9,
    canvasHeight: 1920,
    visualScale: 1,
    bilingual: true,
    fontSize: 30,
    subtitleBottomInset: 122,
  });
  const bandHeight = 1920 * (1 - fitted) / 2;
  assert.ok(bandHeight >= 122 + 70.8 - 1e-6);
});

test('video subject top follows the no-EXIF signature lift', () => {
  const args = {
    canvasWidth: 1920,
    canvasHeight: 1080,
    photoScale: 0.8,
    imageWidth: 1920,
    imageHeight: 1080,
  };
  const plain = videoSubjectTop(args);
  const signed = videoSubjectTop({...args, sign: true});
  assert.ok(signed < plain);
  assert.equal(plain - signed, stillCaptionMetrics({
    ...args,
    visualScale: 1,
    hasExif: false,
    sign: true,
  }).lift);
});
