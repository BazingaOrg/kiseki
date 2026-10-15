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
import {DayStamp} from './DayStamp';
import {childOpacityForParent, filmstripLayerPresentation, photoCaptionLayerPresentation} from './compositionTiming';
import {ensureFonts} from './fonts';
import {Intro, introDuration} from './Intro';
import {Outro, outroOpacityAt} from './Outro';
import {OpeningRecap} from './OpeningRecap';
import {Subtitle} from './Subtitle';
import {resolveSubtitleMode, subtitleBlockHeight, subtitleVisibilityEnd} from './subtitleLayout';
import {PhotoCaption} from './PhotoCaption';
import {photoCaptionPresentation} from './compositionTiming';
import {resolveFontFamily} from './fontFamily';
import {FILMSTRIP_MAIN_PHOTO_FACTOR, FILMSTRIP_MAIN_PHOTO_FACTOR_CAPTION, isCaptionLayout} from './photoCaptionLayout.mjs';
import {ANIMATION, INTRO, OUTRO, SUBTITLE, getPalette, getVisualScale} from './theme';
import {resolveTemplatePresentation} from './templates';
import {fitFadeDuration} from './transition';
import type {PhotoClip, Timeline, VisualClip} from './types';

const clamp = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;

const isPhotoClip = (clip: VisualClip | undefined): clip is PhotoClip =>
  clip !== undefined && clip.kind !== 'chapter' && 'src' in clip && typeof clip.src === 'string';

const isChapterClip = (clip: VisualClip | undefined): clip is Extract<VisualClip, {kind: 'chapter'}> =>
  clip?.kind === 'chapter';

const toStatic = (src: string) => staticFile(src.replace(/^\.\//, ''));


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

  const visualClips = photos.filter((clip) => isPhotoClip(clip) || isChapterClip(clip));
  const photoClips = visualClips.filter(isPhotoClip);
  const hasCaption = photoClips.some((clip) => Boolean(clip.caption) && isCaptionLayout(clip.captionLayout));
  if (hasCaption) ensureFonts('serif');
  const subtitleMode = resolveSubtitleMode(meta.lyrics_mode, subtitles);
  const bilingual = subtitleMode === 'bilingual';
  const eligibleSubtitles = subtitles.filter((line) => line.confidence >= SUBTITLE.confidenceThreshold);
  const stripHeight = height * STRIP_HEIGHT_RATIO;
  const baseMainScale = meta.photo_scale * (hasCaption ? FILMSTRIP_MAIN_PHOTO_FACTOR_CAPTION : FILMSTRIP_MAIN_PHOTO_FACTOR);
  const captionFontSize = (template.captions?.fontSize ?? SUBTITLE.fontSize) * scale;
  const lyricBand = stripHeight + subtitleBlockHeight({fontSize: captionFontSize, bilingual, scale}) + ((template.captions?.riseDistance ?? SUBTITLE.riseDistance) + SUBTITLE.exitRise + 12) * scale;
  const lyricScale = subtitleMode !== 'none' && eligibleSubtitles.length > 0 ? Math.max(0, 1 - 2 * lyricBand / meta.height) : baseMainScale;
  const mainScale = Math.min(baseMainScale, bilingual ? 0.64 : baseMainScale, lyricScale);
  const mainSafeWidth = meta.width * mainScale;
  const mainSafeHeight = meta.height * mainScale;
  const subtitleBandBottom = stripHeight;
  const subtitleBandTop = (1 - mainScale) / 2 * meta.height;
  const bandCenterFromBottom = (subtitleBandBottom + subtitleBandTop) / 2;
  const chapterClips = visualClips.filter(isChapterClip);

  const visibleMainPhotos = visualClips.flatMap((clip, index) => {
    if (!isPhotoClip(clip)) return [];
    const nextClip = visualClips[index + 1];
    const transitionDuration = fitFadeDuration(MAIN_CROSSFADE_DURATION, clip.end - clip.start);
    const presentationStart = meta.opening_recap && clip === photoClips[0]
      ? clip.start - transitionDuration / 2
      : clip.start;
    const presentation = filmstripLayerPresentation({
      time: t,
      start: presentationStart,
      end: clip.end,
      nextPhotoStart: isPhotoClip(nextClip) ? nextClip.start : null,
      transitionDuration,
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

  const visibleSubtitles = subtitleMode === 'none' ? [] : eligibleSubtitles.flatMap((line, index) => {
    const visibilityEnd = subtitleVisibilityEnd({line, nextLine: eligibleSubtitles[index + 1], fadeOutDuration: SUBTITLE.fadeOutDuration});
    return t >= line.start &&
      t <= visibilityEnd + 1 / fps
      ? [{line, visibilityEnd}]
      : [];
  });

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
  const outroText = meta.branding?.outro_text ?? OUTRO.text;
  const audioCredit = meta.audio_credit ?? '';
  const outroOpacity = outroOpacityAt(whiteFade, outroText, audioCredit);
  const captionState = photoCaptionPresentation({
    clips: visualClips,
    frame,
    fps,
    showIntro,
    introEnd: introDuration,
    recapEnd: meta.opening_recap?.end ?? 0,
    durationInFrames,
    entryDelaySeconds: 0.12,
  });
  return (
    <AbsoluteFill style={{backgroundColor: meta.background}}>
      {meta.audio ? (
        <Audio
          src={staticFile(meta.audio.replace(/^\.\//, ''))}
          volume={(f) => interpolate(f, [audioFadeStart, durationInFrames - 1], [1, 0], clamp)}
        />
      ) : null}
      {visibleMainPhotos.map(({clip, opacity}) => {
        const caption = photoCaptionLayerPresentation({clip, hasLayout: isCaptionLayout(clip.captionLayout), state: captionState});
        return (
        <AbsoluteFill key={`${clip.src}-${clip.start}`} style={{justifyContent: 'center', alignItems: 'center', opacity}}>
          {caption.render ? (
            <PhotoCaption
              text={clip.caption!}
              layout={clip.captionLayout}
              palette={palette}
              fontFamily={resolveFontFamily(clip.caption!, 'zh')}
              opacity={childOpacityForParent(caption.opacity, opacity)}
            />
          ) : null}
          <div style={{position: 'relative', display: 'inline-flex', maxWidth: '86%'}}>
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
              <DayStamp text={clip.day_mark} scale={scale} fontFamily={template.fontFamily} />
            </div>
        </AbsoluteFill>
        );
      })}
      {chapterClips.filter((clip) => t >= clip.start && t <= clip.end).map((clip) => (
        <ChapterCard key={`${clip.start}-${clip.text}`} clip={clip} background={meta.background} palette={palette} style={template.chapterCard} fontFamily={template.fontFamily} />
      ))}
      {visibleSubtitles.map(({line: l, visibilityEnd}) => (
        <Subtitle
          key={`${l.start}-${l.text}`}
          line={l}
          scale={scale}
          bandCenterFromBottom={bandCenterFromBottom}
          bandBottomFromBottom={subtitleBandBottom}
          bandTopFromBottom={subtitleBandTop}
          palette={palette}
          captions={template.captions}
          fontFamily={template.fontFamily}
          bilingual={bilingual}
          visibilityEnd={visibilityEnd}
        />
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
      <OpeningRecap
        meta={meta}
        photos={photoClips}
        palette={palette}
        variant="filmstrip"
        photoScale={mainScale / 0.92}
      />
      {whiteFade > 0 ? <AbsoluteFill style={{backgroundColor: meta.background, opacity: whiteFade}} /> : null}
      <Outro text={outroText} credit={audioCredit} scale={scale} opacity={outroOpacity} palette={palette} fontFamily={template.fontFamily} />
      {showIntro && frame <= Math.round(introDuration * fps) ? (
        <Intro backgroundColor={meta.background} scale={scale} signatureSrc={signatureSrc} palette={palette} />
      ) : null}
    </AbsoluteFill>
  );
};
