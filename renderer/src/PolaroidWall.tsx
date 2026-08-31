/**
 * 拍立得布局 composition:照片以白色相框的拍立得卡片呈现,确定性轻微旋转
 * (±4°,按照片 src 稳定哈希分配,逐帧可复现),入场从更大角度旋转落定。
 *
 * 与 Diary 消费同一份 timeline(meta/photos/subtitles):字幕复用 Subtitle
 * 组件走底部字幕带,章节卡复用 ChapterCard,音频淡出/片尾白场同款收尾。
 * 模板的 transition 字段对本 composition 无意义——卡片有自己的入场动效。
 */
import React from 'react';
import {AbsoluteFill, Audio, Img, interpolate, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import {ChapterCard} from './ChapterCard';
import {polaroidCardPresentation} from './compositionTiming';
import {ensureFonts} from './fonts';
import {Intro, introDuration} from './Intro';
import {OpeningRecap} from './OpeningRecap';
import {Subtitle} from './Subtitle';
import {hashString} from './motion';
import {ANIMATION, INTRO, getPalette, getVisualScale} from './theme';
import {resolveTemplatePresentation} from './templates';
import type {PhotoClip, Timeline, VisualClip} from './types';

const clamp = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;

const isPhotoClip = (clip: VisualClip | undefined): clip is PhotoClip =>
  clip !== undefined && clip.kind !== 'chapter' && 'src' in clip && typeof clip.src === 'string';

const isChapterClip = (clip: VisualClip | undefined): clip is Extract<VisualClip, {kind: 'chapter'}> =>
  clip?.kind === 'chapter';

const toStatic = (src: string) => staticFile(src.replace(/^\.\//, ''));

const SUBTITLE_CONFIDENCE = 0.6;
const SUBTITLE_FADE_OUT = 0.25;

export const PolaroidWall: React.FC<Timeline> = ({meta, photos, subtitles}) => {
  const frame = useCurrentFrame();
  const {fps, width, height, durationInFrames} = useVideoConfig();
  const t = frame / fps;
  const palette = getPalette(meta.background);
  const scale = getVisualScale(width, height);
  const template = resolveTemplatePresentation(meta.templateId);
  ensureFonts(template.fontFamily);

  const safeWidth = meta.width * meta.photo_scale;
  const safeHeight = meta.height * meta.photo_scale;
  const bandCenterFromBottom = (meta.height * (1 - meta.photo_scale)) / 4;

  const visualClips = photos.filter((clip) => isPhotoClip(clip) || isChapterClip(clip));
  const chapterClips = visualClips.filter(isChapterClip);
  const visibleSubtitles = subtitles.filter(
    (l) =>
      t >= (meta.opening_recap?.end ?? 0) &&
      l.confidence >= SUBTITLE_CONFIDENCE &&
      t >= l.start - 1 / fps &&
      t <= l.end + SUBTITLE_FADE_OUT + 1 / fps,
  );

  // 收尾:音频淡出与画面淡白,与 Diary 同款
  const audioFadeStart = Math.max(0, durationInFrames - Math.round(1.5 * fps));
  const whiteFadeStart = Math.max(0, durationInFrames - Math.round(2.5 * fps));
  const whiteFade = interpolate(frame, [whiteFadeStart, durationInFrames - 1], [0, 1], clamp);
  const photoClips = visualClips.filter(isPhotoClip);
  const introEnabled = meta.branding?.intro !== false;
  const showIntro =
    introEnabled &&
    photoClips.length > 0 &&
    (meta.opening_recap
      ? meta.opening_recap.start >= introDuration
      : photoClips[0].end >= introDuration + INTRO.minPhotoVisible &&
        durationInFrames / fps >= introDuration + ANIMATION.whiteFadeDuration + INTRO.minPhotoVisible);
  const signatureSrc = meta.branding?.signature?.replace(/^\.\//, '');

  const cards = visualClips.flatMap((clip, index) => {
    if (!isPhotoClip(clip)) return [];
    const nextClip = visualClips[index + 1];
    const presentationStart = meta.opening_recap && clip === photoClips[0]
      ? clip.start - 0.4
      : clip.start;
    const presentation = polaroidCardPresentation({
      time: t,
      start: presentationStart,
      end: clip.end,
      nextPhotoStart: isPhotoClip(nextClip) ? nextClip.start : null,
      rotation: (hashString(clip.src) % 9) - 4,
    });
    return presentation.visible ? [{clip, ...presentation}] : [];
  });

  return (
    <AbsoluteFill style={{backgroundColor: meta.background}}>
      <Audio
        src={staticFile(meta.audio.replace(/^\.\//, ''))}
        volume={(f) => interpolate(f, [audioFadeStart, durationInFrames - 1], [1, 0], clamp)}
      />
      {cards.map(({clip, rotation, opacity}) => (
        <AbsoluteFill key={`${clip.src}-${clip.start}`} style={{justifyContent: 'center', alignItems: 'center', opacity}}>
          <div
            style={{
              transform: `rotate(${rotation}deg)`,
              background: '#fff',
              padding: Math.round(safeWidth * 0.03),
              borderRadius: Math.round(4 * scale),
              boxShadow: '0 14px 36px rgba(10, 12, 16, 0.26)',
            }}
          >
            <Img
              src={toStatic(clip.src)}
              style={{
                display: 'block',
                maxWidth: safeWidth * 0.9,
                maxHeight: safeHeight * 0.9,
                objectFit: 'contain',
                background: '#000',
              }}
            />
          </div>
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
      <OpeningRecap meta={meta} photos={photoClips} palette={palette} variant="polaroid" />
      {whiteFade > 0 ? <AbsoluteFill style={{backgroundColor: meta.background, opacity: whiteFade}} /> : null}
      {showIntro && frame <= Math.round(introDuration * fps) ? (
        <Intro backgroundColor={meta.background} scale={scale} signatureSrc={signatureSrc} palette={palette} />
      ) : null}
    </AbsoluteFill>
  );
};
