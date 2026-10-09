import assert from 'node:assert/strict';
import test from 'node:test';

import {childOpacityForParent, filmstripLayerPresentation, photoCaptionLayerPresentation, photoCaptionPresentation, polaroidCardPresentation} from './compositionTiming.ts';

test('filmstrip crossfade keeps the outgoing layer visible while the next photo enters', () => {
  const outgoing = filmstripLayerPresentation({time: 4, start: 0, end: 4, nextPhotoStart: 4, transitionDuration: 0.6});
  const incoming = filmstripLayerPresentation({time: 4, start: 4, end: 8, nextPhotoStart: null, transitionDuration: 0.6});
  assert.deepEqual(outgoing, {visible: true, opacity: 1});
  assert.equal(incoming.visible, true);
  assert.ok(incoming.opacity > 0);
});

test('polaroid replacement overlaps cards instead of fading through an empty stage', () => {
  const outgoing = polaroidCardPresentation({time: 4.15, start: 0, end: 4, nextPhotoStart: 4, rotation: -2});
  const incoming = polaroidCardPresentation({time: 4.15, start: 4, end: 8, nextPhotoStart: null, rotation: 3});
  assert.equal(outgoing.visible, true);
  assert.equal(incoming.visible, true);
  assert.ok(outgoing.opacity > 0);
  assert.ok(incoming.opacity > 0);
});

test('last polaroid card keeps the existing fade-out behavior', () => {
  const card = polaroidCardPresentation({time: 3.85, start: 0, end: 4, nextPhotoStart: null, rotation: 1});
  assert.equal(card.visible, true);
  assert.ok(Math.abs(card.opacity - 0.5) < Number.EPSILON);
  assert.equal(card.rotation, 1);
});

test('opening recap preroll leaves filmstrip and polaroid fully settled at handoff', () => {
  const bodyStart = 4.017;
  const filmstrip = filmstripLayerPresentation({
    time: bodyStart,
    start: bodyStart - 0.3,
    end: 6,
    nextPhotoStart: null,
    transitionDuration: 0.6,
  });
  const polaroid = polaroidCardPresentation({
    time: bodyStart,
    start: bodyStart - 0.4,
    end: 6,
    nextPhotoStart: null,
    rotation: -2,
  });
  assert.deepEqual(filmstrip, {visible: true, opacity: 1});
  assert.equal(polaroid.opacity, 1);
  assert.equal(polaroid.rotation, -2);
});

test('photo captions follow every body photo, including short clips', () => {
  const clips = [
    {kind: 'photo', src: 'a.jpg', start: 0, end: 1},
    {kind: 'photo', src: 'b.jpg', start: 3, end: 8},
    {kind: 'chapter', start: 8, end: 10},
  ];
  const fps = 60;
  const durationInFrames = 12 * fps;
  const short = photoCaptionPresentation({
    clips, frame: Math.round(0.5 * fps), fps, showIntro: false, introEnd: 0, recapEnd: 0, durationInFrames,
  });
  assert.equal(short.visible, true);
  assert.equal(short.clip?.src, 'a.jpg');
  const mid = photoCaptionPresentation({
    clips, frame: Math.round(5 * fps), fps, showIntro: false, introEnd: 0, recapEnd: 0, durationInFrames,
  });
  assert.equal(mid.visible, true);
  assert.equal(mid.clip?.src, 'b.jpg');
  const switchFrame = photoCaptionPresentation({
    clips, frame: Math.ceil(8 * fps), fps, showIntro: false, introEnd: 0, recapEnd: 0, durationInFrames,
  });
  assert.equal(switchFrame.visible, false);
});

test('date chapter cards do not swallow captions of the surrounding photos', () => {
  const clips = [
    {kind: 'photo', src: 'a.jpg', caption: '第一句', start: 0, end: 8},
    {kind: 'chapter', text: '第2天', start: 2, end: 4},
    {kind: 'photo', src: 'b.jpg', caption: '第二句', start: 8, end: 12},
  ];
  const fps = 60;
  const durationInFrames = 12 * fps;
  const duringChapter = photoCaptionPresentation({
    clips, frame: Math.round(3 * fps), fps, showIntro: false, introEnd: 0, recapEnd: 0, durationInFrames,
  });
  assert.equal(duringChapter.visible, true);
  assert.equal(duringChapter.clip?.src, 'a.jpg');
  const afterChapter = photoCaptionPresentation({
    clips, frame: Math.round(6 * fps), fps, showIntro: false, introEnd: 0, recapEnd: 0, durationInFrames,
  });
  assert.equal(afterChapter.visible, true);
  assert.equal(afterChapter.clip?.src, 'a.jpg');
});

test('photo captions stay hidden during the opening recap', () => {
  const clips = [
    {kind: 'photo', src: 'a.jpg', start: 0, end: 3},
    {kind: 'photo', src: 'b.jpg', start: 3, end: 8},
  ];
  const fps = 60;
  const durationInFrames = 8 * fps;
  const recap = photoCaptionPresentation({
    clips, frame: Math.round(1.5 * fps), fps, showIntro: false, introEnd: 0, recapEnd: 2, durationInFrames,
  });
  assert.equal(recap.visible, false);
  const body = photoCaptionPresentation({
    clips, frame: Math.round(2.5 * fps), fps, showIntro: false, introEnd: 0, recapEnd: 2, durationInFrames,
  });
  assert.equal(body.visible, true);
  assert.equal(body.clip?.src, 'a.jpg');
});

test('crossfading photo layers reserve valid caption layout but only the active caption is visible', () => {
  const active = {caption: '当前'};
  const outgoing = {caption: '上一张'};
  const state = {visible: true, opacity: 0.65, clip: active};
  assert.deepEqual(photoCaptionLayerPresentation({clip: active, hasLayout: true, state}), {render: true, opacity: 0.65});
  assert.deepEqual(photoCaptionLayerPresentation({clip: outgoing, hasLayout: true, state}), {render: true, opacity: 0});
  assert.deepEqual(photoCaptionLayerPresentation({clip: active, hasLayout: false, state}), {render: false, opacity: 0});
});

test('nested caption opacity compensates for the parent photo fade', () => {
  assert.equal(childOpacityForParent(0.25, 0.5), 0.5);
  assert.equal(childOpacityForParent(0.5, 0.25), 1);
  assert.equal(childOpacityForParent(0, 0.5), 0);
  assert.equal(childOpacityForParent(0.5, 0), 0);
});
