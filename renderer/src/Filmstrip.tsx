/**
 * 走带布局 composition:当前照片大图,底部一条前/当前/后三帧的小图走带,
 * 当前帧高亮。字幕带挤到主照片与走带之间。
 *
 * 与 Diary/PolaroidWall 消费同一份 timeline:字幕复用 Subtitle,章节卡复用
 * ChapterCard,音频淡出/片尾白场同款收尾。走带里同一张照片不会重复出现——
 * 相邻帧就是 timeline 里的前后照片。
 */
import React from 'react';
import {AbsoluteFill, Audio, Img, interpolate, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import {ChapterCard} from './ChapterCard';
import {filmstripLayerPresentation} from './compositionTiming';
import {ensureFonts} from './fonts';
import {Intro, introDuration} from './Intro';
import {OpeningRecap} from './OpeningRecap';
import {Subtitle} from './Subtitle';
import {ANIMATION, INTRO, getPalette, getVisualScale} from './theme';
import {resolveTemplatePresentation} from './templates';
import type {PhotoClip, Timeline, VisualClip} from './types';

const clamp = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;

const isPhotoClip = (clip: VisualClip | undefined): clip is PhotoClip =>
  clip !== undefined && clip.kind !== 'chapter' && 'src' in clip && typeof clip.src === 'string';

const isChapterClip = (clip: VisualClip | undefined): clip is Extract<VisualClip, {kind: 'chapter'}> =>
  clip?.kind === 'chapter';

const toStatic = (src: string) => staticFile(src.replace(/^\.\//, ''));

// 主照片在 photo_scale 基础上再缩 8%:给底部走带留出空间
const MAIN_PHOTO_FACTOR = 0.92;
// 走带高度占画布比例
const STRIP_HEIGHT_RATIO = 0.09;
const MAIN_CROSSFADE_DURATION = 0.6;

export const Filmstrip: React.FC<Timeline> = ({meta, photos, subtitles}) => {
  const frame = useCurrentFrame();
  const {fps, width, height, durationInFrames} = useVideoConfig();
  const t = frame / fps;
  const palette = getPalette(meta.background);
  const scale = getVisualScale(width, height);
  const template = resolveTemplatePresentation(meta.templateId);
  ensureFonts(template.fontFamily);

  const mainScale = meta.photo_scale * MAIN_PHOTO_FACTOR;
  const mainSafeWidth = meta.width * mainScale;
  const mainSafeHeight = meta.height * mainScale;
  const stripHeight = height * STRIP_HEIGHT_RATIO;
  // 字幕带:主照片下缘与走带上缘之间的中线;photo_scale 极大时下缘会低于走带
  // 上缘,钳到走带上沿之上,保证字幕永远不压到走带
  const bandCenterFromBottom = Math.max(
    stripHeight + 24 * scale,
    ((1 - mainScale) / 2 * meta.height + stripHeight) / 2,
  );

  const visualClips = photos.filter((clip) => isPhotoClip(clip) || isChapterClip(clip));
  const photoClips = visualClips.filter(isPhotoClip);
  const chapterClips = visualClips.filter(isChapterClip);

  const visibleMainPhotos = visualClips.flatMap((clip, index) => {
    if (!isPhotoClip(clip)) return [];
    const nextClip = visualClips[index + 1];
    const presentationStart = meta.opening_recap && clip === photoClips[0]
      ? clip.start - MAIN_CROSSFADE_DURATION / 2
      : clip.start;
    const presentation = filmstripLayerPresentation({
      time: t,
      start: presentationStart,
      end: clip.end,
      nextPhotoStart: isPhotoClip(nextClip) ? nextClip.start : null,
      transitionDuration: MAIN_CROSSFADE_DURATION,
    });
    return presentation.visible ? [{clip, opacity: presentation.opacity}] : [];
  });

  const activeIndex = photoClips.findIndex(
    (clip, index) => t >= clip.start && (t < clip.end || (index === photoClips.length - 1 && t <= clip.end)),
  );
  const active = activeIndex >= 0 ? photoClips[activeIndex] : null;
  const strip = activeIndex >= 0
    ? [-1, 0, 1]
        .map((offset) => photoClips[activeIndex + offset])
        .filter((clip): clip is PhotoClip => clip !== undefined)
    : [];

  const visibleSubtitles = subtitles.filter(
    (l) =>
      t >= (meta.opening_recap?.end ?? 0) &&
      l.confidence >= 0.6 &&
      t >= l.start - 1 / fps &&
      t <= l.end + 0.25 + 1 / fps,
  );

  // 收尾:音频淡出与画面淡白,与 Diary 同款
  const audioFadeStart = Math.max(0, durationInFrames - Math.round(1.5 * fps));
  const whiteFadeStart = Math.max(0, durationInFrames - Math.round(2.5 * fps));
  const whiteFade = interpolate(frame, [whiteFadeStart, durationInFrames - 1], [0, 1], clamp);
  const introEnabled = meta.branding?.intro !== false;
  const showIntro =
    introEnabled &&
    photoClips.length > 0 &&
    (meta.opening_recap
      ? meta.opening_recap.start >= introDuration
      : photoClips[0].end >= introDuration + INTRO.minPhotoVisible &&
        durationInFrames / fps >= introDuration + ANIMATION.whiteFadeDuration + INTRO.minPhotoVisible);
  const signatureSrc = meta.branding?.signature?.replace(/^\.\//, '');

  return (
    <AbsoluteFill style={{backgroundColor: meta.background}}>
      <Audio
        src={staticFile(meta.audio.replace(/^\.\//, ''))}
        volume={(f) => interpolate(f, [audioFadeStart, durationInFrames - 1], [1, 0], clamp)}
      />
      {visibleMainPhotos.map(({clip, opacity}) => (
        <AbsoluteFill key={`${clip.src}-${clip.start}`} style={{justifyContent: 'center', alignItems: 'center', opacity}}>
          <Img
            src={toStatic(clip.src)}
            style={{
              display: 'block',
              maxWidth: mainSafeWidth,
              maxHeight: mainSafeHeight,
              objectFit: 'contain',
              borderRadius: Math.round(3 * scale),
              boxShadow: '0 14px 36px rgba(10, 12, 16, 0.22)',
            }}
          />
        </AbsoluteFill>
      ))}
      {visibleSubtitles.map((l) => (
        <Subtitle
          key={`${l.start}-${l.text}`}
          line={l}
          scale={scale}
          bandCenterFromBottom={bandCenterFromBottom}
          palette={palette}
          captions={template.captions}
          fontFamily={template.fontFamily}
        />
      ))}
      {chapterClips.filter((clip) => t >= clip.start && t <= clip.end).map((clip) => (
        <ChapterCard key={`${clip.start}-${clip.text}`} clip={clip} background={meta.background} palette={palette} style={template.chapterCard} fontFamily={template.fontFamily} />
      ))}
      {/* 底部走带:前/当前/后三帧,当前帧高亮 */}
      {active ? <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: stripHeight,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: Math.round(10 * scale),
          background: 'rgba(10, 12, 16, 0.35)',
        }}
      >
        {strip.map((clip, index) => {
          const isCurrent = clip === active;
          return (
            <Img
              key={`${clip.src}-${index}`}
              src={toStatic(clip.src)}
              style={{
                display: 'block',
                height: stripHeight * 0.72,
                maxWidth: width * 0.24,
                objectFit: 'contain',
                opacity: isCurrent ? 1 : 0.55,
                borderRadius: Math.round(2 * scale),
                boxShadow: isCurrent ? `0 0 0 2px ${palette.text}` : 'none',
              }}
            />
          );
        })}
      </div> : null}
      <OpeningRecap meta={meta} photos={photoClips} palette={palette} variant="filmstrip" />
      {whiteFade > 0 ? <AbsoluteFill style={{backgroundColor: meta.background, opacity: whiteFade}} /> : null}
      {showIntro && frame <= Math.round(introDuration * fps) ? (
        <Intro backgroundColor={meta.background} scale={scale} signatureSrc={signatureSrc} palette={palette} />
      ) : null}
    </AbsoluteFill>
  );
};
