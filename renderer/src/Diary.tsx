import React from 'react';
import {
  AbsoluteFill,
  Audio,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import {ensureFonts} from './fonts';
import {Intro, introDuration} from './Intro';
import {Outro} from './Outro';
import {Photo, hasDisplayableExif} from './Photo';
import {ChapterCard} from './ChapterCard';
import {getSignatureDisplayWidth, useSignatureData} from './Signature';
import {Subtitle} from './Subtitle';
import {ANIMATION, INTRO, OUTRO, STILL, SUBTITLE, getPalette, getVisualScale} from './theme';
import {getFadeDuration} from './transition';
import type {PhotoClip, Timeline, VisualClip} from './types';
import {resolveTemplatePresentation} from './templates';

const clamp = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;

const isPhotoClip = (clip: VisualClip | undefined): clip is PhotoClip =>
  clip !== undefined && clip.kind !== 'chapter' && (!('kind' in clip) || clip.kind === undefined || clip.kind === 'photo') && 'src' in clip && typeof clip.src === 'string';

const isChapterClip = (clip: VisualClip | undefined): clip is Extract<VisualClip, {kind: 'chapter'}> => clip?.kind === 'chapter';

/**
 * 主 Composition:消费 timeline.json(即组件 props)。
 * photos 与 subtitles 是两条独立时间线,各自渲染互不影响。
 */
export const Diary: React.FC<Timeline> = ({meta, photos, subtitles}) => {
  const frame = useCurrentFrame();
  const {fps, width, height, durationInFrames} = useVideoConfig();
  const t = frame / fps;
  const palette = getPalette(meta.background);
  // 呈现层模板:只覆盖照片转场与字幕/章节卡长相;缺省(无 templateId)全部回落现有常量
  const template = resolveTemplatePresentation(meta.templateId);
  ensureFonts(template.fontFamily);

  // 视觉规格以 1080p 为基准,非 1080p 输出等比缩放
  const scale = getVisualScale(width, height);
  const safeWidth = meta.width * meta.photo_scale;
  const safeHeight = meta.height * meta.photo_scale;

  // 字幕带:照片安全框下缘到画布底部,行框垂直居中于此
  const bandCenterFromBottom = (meta.height * (1 - meta.photo_scale)) / 4;

  // 只挂载当前可见的照片(含淡化前后沿)
  const visualClips = photos.filter((clip) => isPhotoClip(clip) || isChapterClip(clip));
  const photoClips = visualClips.filter(isPhotoClip);
  const chapterClips = visualClips.filter(isChapterClip);
  const visiblePhotos: Array<{clip: PhotoClip; index: number}> = [];
  for (let index = 0; index < visualClips.length; index += 1) {
    const clip = visualClips[index];
    if (!isPhotoClip(clip)) continue;
    // 模板转场是呈现层默认,取代 timeline 里的逐 clip 转场;chapter 卡保持自身节奏
    const effective = template.transition === undefined ? clip : {...clip, transition: template.transition};
    const dIn = getFadeDuration(effective.transition);
    const nextClip = visualClips[index + 1];
    const dOut = isPhotoClip(nextClip) ? getFadeDuration(template.transition ?? nextClip.transition) : 0;
    if (
      t >= clip.start - dIn / 2 - 1 / fps &&
      t <= clip.end + dOut / 2 + 1 / fps
    ) {
      visiblePhotos.push({clip: effective, index});
    }
  }

  const visibleSubtitles = subtitles.filter(
    (l) =>
      l.confidence >= SUBTITLE.confidenceThreshold &&
      t >= l.start - 1 / fps &&
      t <= l.end + SUBTITLE.fadeOutDuration + 1 / fps,
  );

  // 收尾:音频淡出与画面淡白各自计时(白场更长,给谢幕语留可读时间)。
  // 下界钳到 0,防止过短的合成从首帧就开始泛白/压音量
  const audioFadeStart = Math.max(0, durationInFrames - Math.round(ANIMATION.audioFadeDuration * fps));
  const whiteFadeStart = Math.max(0, durationInFrames - Math.round(ANIMATION.whiteFadeDuration * fps));
  const whiteFade = interpolate(frame, [whiteFadeStart, durationInFrames - 1], [0, 1], clamp);

  // 片头跳过规则:配置关闭、第一张照片被盖太多,或总时长短到片头会撞上片尾白场
  const introEnabled = meta.branding?.intro !== false;
  const showIntro =
    introEnabled &&
    photoClips.length > 0 &&
    photoClips[0].end >= introDuration + INTRO.minPhotoVisible &&
    durationInFrames / fps >= introDuration + ANIMATION.whiteFadeDuration + INTRO.minPhotoVisible;

  const outroText = meta.branding?.outro_text ?? OUTRO.text;
  const outroOpacity =
    outroText === ''
      ? 0
      : interpolate(whiteFade, [...OUTRO.fadeRange], [0, 1], clamp);
  const signatureSrc = meta.branding?.signature?.replace(/^\.\//, '');
  // 照片落款:hook 不能按 clip 条件调用,统一在 Diary 层调用一次;sign 关闭时不传给 Photo
  const photoSignature = useSignatureData(meta.sign ? signatureSrc : undefined);
  const bottomSignatureVisible = Boolean(
    meta.sign &&
      photoSignature &&
      visiblePhotos.some(({clip}) => !hasDisplayableExif(clip.exif)),
  );
  const signatureWidth = photoSignature
    ? getSignatureDisplayWidth(
        photoSignature,
        STILL.signature.height * scale,
        meta.width * STILL.signature.maxWidthRatio,
      )
    : 0;
  const subtitleSideInset = bottomSignatureVisible
    ? STILL.signature.rightInset * scale +
      signatureWidth +
      STILL.signature.subtitleGap * scale
    : 0;

  return (
    <AbsoluteFill style={{backgroundColor: meta.background}}>
      <Audio
        src={staticFile(meta.audio.replace(/^\.\//, ''))}
        volume={(f) => interpolate(f, [audioFadeStart, durationInFrames - 1], [1, 0], clamp)}
      />
      {visiblePhotos.map(({clip, index}) => (
        <Photo
          key={`${clip.src}-${index}`}
          clip={clip}
          backgroundColor={meta.background}
          safeWidth={safeWidth}
          safeHeight={safeHeight}
          palette={palette}
          canvasWidth={meta.width}
          canvasHeight={meta.height}
          sign={meta.sign}
          signature={meta.sign ? photoSignature : undefined}
          filter={clip.filter ?? meta.filter}
          motion={template.motion}
          fontFamily={template.fontFamily}
        />
      ))}
      {visibleSubtitles.map((l) => (
        <Subtitle
          key={`${l.start}-${l.text}`}
          line={l}
          scale={scale}
          bandCenterFromBottom={bandCenterFromBottom}
          sideInset={subtitleSideInset}
          palette={palette}
          captions={template.captions}
          fontFamily={template.fontFamily}
        />
      ))}
      {chapterClips.filter((clip) => t >= clip.start && t <= clip.end).map((clip) => <ChapterCard key={`${clip.start}-${clip.text}`} clip={clip} background={meta.background} palette={palette} style={template.chapterCard} fontFamily={template.fontFamily} />)}
      {whiteFade > 0 ? (
        <AbsoluteFill style={{backgroundColor: meta.background, opacity: whiteFade}} />
      ) : null}
      {/* 谢幕语:白场过半后浮现,持续到最后一帧;空串隐藏 */}
      <Outro text={outroText} scale={scale} opacity={outroOpacity} palette={palette} fontFamily={template.fontFamily} />
      {/* 片头写签名:盖在一切之上,淡出后露出已在播放的第一页。
          按帧比较,避免浮点求和导致收尾帧(opacity 归零帧)被提前跳过 */}
      {showIntro && frame <= Math.round(introDuration * fps) ? (
        <Intro
          backgroundColor={meta.background}
          scale={scale}
          signatureSrc={signatureSrc}
          palette={palette}
        />
      ) : null}
    </AbsoluteFill>
  );
};
