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
import {DayStamp} from './DayStamp';
import {childOpacityForParent, photoCaptionLayerPresentation, polaroidCardPresentation} from './compositionTiming';
import {ensureFonts} from './fonts';
import {Intro, introDuration} from './Intro';
import {Outro, outroOpacityAt} from './Outro';
import {OpeningRecap} from './OpeningRecap';
import {Subtitle} from './Subtitle';
import {resolveSubtitleMode, subtitleBlockHeight, subtitleVisibilityEnd} from './subtitleLayout';
import {hashString} from './motion';
import {PhotoCaption} from './PhotoCaption';
import {photoCaptionPresentation} from './compositionTiming';
import {resolveFontFamily} from './fontFamily';
import {POLAROID_PHOTO_FACTOR, POLAROID_PHOTO_FACTOR_CAPTION, isCaptionLayout} from './photoCaptionLayout.mjs';
import {ANIMATION, INTRO, OUTRO, SUBTITLE, getPalette, getVisualScale} from './theme';
import {resolveTemplatePresentation} from './templates';
import type {PhotoClip, Timeline, VisualClip} from './types';

const clamp = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;

const isPhotoClip = (clip: VisualClip | undefined): clip is PhotoClip =>
  clip !== undefined && clip.kind !== 'chapter' && 'src' in clip && typeof clip.src === 'string';

const isChapterClip = (clip: VisualClip | undefined): clip is Extract<VisualClip, {kind: 'chapter'}> =>
  clip?.kind === 'chapter';

const toStatic = (src: string) => staticFile(src.replace(/^\.\//, ''));

export const PolaroidWall: React.FC<Timeline> = ({meta, photos, subtitles}) => {
  const frame = useCurrentFrame();
  const {fps, width, height, durationInFrames} = useVideoConfig();
  const t = frame / fps;
  const palette = getPalette(meta.background);
  const scale = getVisualScale(width, height);
  const template = resolveTemplatePresentation(meta.templateId);
  ensureFonts(template.fontFamily);

  const hasCaption = photos.some((clip) => 'caption' in clip && Boolean(clip.caption) && isCaptionLayout(clip.captionLayout));
  if (hasCaption) ensureFonts('serif');
  const subtitleMode = resolveSubtitleMode(meta.lyrics_mode, subtitles);
  const bilingual = subtitleMode === 'bilingual';
  const eligibleSubtitles = subtitles.filter((line) => line.confidence >= SUBTITLE.confidenceThreshold);
  const basePhotoFactor = hasCaption ? POLAROID_PHOTO_FACTOR_CAPTION : POLAROID_PHOTO_FACTOR;
  const safeWidth = meta.width * meta.photo_scale;
  const safeHeight = meta.height * meta.photo_scale;
  const cardPadding = Math.round(safeWidth * 0.03) * 2;
  const maxRotation = 4 * Math.PI / 180;
  const captionFontSize = (template.captions?.fontSize ?? SUBTITLE.fontSize) * scale;
  const lyricBand = subtitleBlockHeight({fontSize: captionFontSize, bilingual, scale}) + ((template.captions?.riseDistance ?? SUBTITLE.riseDistance) + SUBTITLE.exitRise + 12) * scale;
  const factorLimit = (meta.height - 2 * lyricBand - cardPadding * (Math.cos(maxRotation) + Math.sin(maxRotation))) / (safeHeight * Math.cos(maxRotation) + safeWidth * Math.sin(maxRotation));
  const lyricFactor = subtitleMode !== 'none' && eligibleSubtitles.length > 0 ? Math.max(0, factorLimit) : basePhotoFactor;
  const photoFactor = Math.min(basePhotoFactor, bilingual ? 0.8 : basePhotoFactor, lyricFactor);
  const maxCardHeight =
    (safeHeight * photoFactor + cardPadding) * Math.cos(maxRotation) +
    (safeWidth * photoFactor + cardPadding) * Math.sin(maxRotation);
  const subtitleBandTop = Math.max(0, (meta.height - maxCardHeight) / 2);
  const bandCenterFromBottom = subtitleBandTop / 2;

  const visualClips = photos.filter((clip) => isPhotoClip(clip) || isChapterClip(clip));
  const chapterClips = visualClips.filter(isChapterClip);
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
      {meta.audio ? (
        <Audio
          src={staticFile(meta.audio.replace(/^\.\//, ''))}
          volume={(f) => interpolate(f, [audioFadeStart, durationInFrames - 1], [1, 0], clamp)}
        />
      ) : null}
      {cards.map(({clip, rotation, opacity}) => {
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
          <div
              style={{
                transform: `rotate(${rotation}deg)`,
                background: '#fff',
                padding: Math.round(safeWidth * 0.03),
                borderRadius: Math.round(4 * scale),
                boxShadow: '0 14px 36px rgba(10, 12, 16, 0.26)',
              }}
            >
              <div style={{position: 'relative', display: 'inline-flex', maxWidth: '100%'}}>
                <Img
                  src={toStatic(clip.src)}
                  style={{
                    display: 'block',
                    maxWidth: safeWidth * photoFactor,
                    maxHeight: safeHeight * photoFactor,
                    objectFit: 'contain',
                    background: '#000',
                  }}
                />
                <DayStamp text={clip.day_mark} scale={scale} fontFamily={template.fontFamily} />
              </div>
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
          bandTopFromBottom={subtitleBandTop}
          palette={palette}
          captions={template.captions}
          fontFamily={template.fontFamily}
          bilingual={bilingual}
          visibilityEnd={visibilityEnd}
        />
      ))}
      <OpeningRecap
        meta={meta}
        photos={photoClips}
        palette={palette}
        variant="polaroid"
        photoScale={meta.photo_scale * photoFactor / 0.9}
      />
      {whiteFade > 0 ? <AbsoluteFill style={{backgroundColor: meta.background, opacity: whiteFade}} /> : null}
      <Outro text={outroText} credit={audioCredit} scale={scale} opacity={outroOpacity} palette={palette} fontFamily={template.fontFamily} />
      {showIntro && frame <= Math.round(introDuration * fps) ? (
        <Intro backgroundColor={meta.background} scale={scale} signatureSrc={signatureSrc} palette={palette} />
      ) : null}
    </AbsoluteFill>
  );
};
