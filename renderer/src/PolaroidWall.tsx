/**
 * 拍立得布局 composition:照片以白色相框的拍立得卡片呈现,确定性轻微旋转
 * (±4°,按照片 src 稳定哈希分配,逐帧可复现),入场从更大角度旋转落定。
 *
 * 与 Diary 消费同一份 timeline(meta/photos/subtitles):字幕复用 Subtitle
 * 组件走底部字幕带,章节卡复用 ChapterCard,音频淡出/片尾白场同款收尾。
 * 模板的 transition 字段对本 composition 无意义——卡片有自己的入场动效。
 */
import React from 'react';
import {AbsoluteFill, Audio, interpolate, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import {ChapterCard} from './ChapterCard';
import {Subtitle} from './Subtitle';
import {hashString} from './motion';
import {getPalette, getVisualScale} from './theme';
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

  const safeWidth = meta.width * meta.photo_scale;
  const safeHeight = meta.height * meta.photo_scale;
  const bandCenterFromBottom = (meta.height * (1 - meta.photo_scale)) / 4;

  const visualClips = photos.filter((clip) => isPhotoClip(clip) || isChapterClip(clip));
  // 当前时刻的照片:含淡入淡出前后沿(与 Diary 的可见窗口同语义)
  const activeClip = visualClips.find(
    (clip) => isPhotoClip(clip) && t >= clip.start - 0.2 && t <= clip.end + 0.3,
  );
  const active = isPhotoClip(activeClip) ? activeClip : null;
  const chapterClips = visualClips.filter(isChapterClip);
  const visibleSubtitles = subtitles.filter(
    (l) =>
      l.confidence >= SUBTITLE_CONFIDENCE &&
      t >= l.start - 1 / fps &&
      t <= l.end + SUBTITLE_FADE_OUT + 1 / fps,
  );

  // 收尾:音频淡出与画面淡白,与 Diary 同款
  const audioFadeStart = Math.max(0, durationInFrames - Math.round(1.5 * fps));
  const whiteFadeStart = Math.max(0, durationInFrames - Math.round(2.5 * fps));
  const whiteFade = interpolate(frame, [whiteFadeStart, durationInFrames - 1], [0, 1], clamp);

  // 当前照片的卡片姿态:确定性旋转 + 入场旋转落定 + 淡入淡出
  let card: {src: string; rotation: number; opacity: number} | null = null;
  if (active) {
    const rotation = (hashString(active.src) % 9) - 4;
    const inEnd = active.start + 0.4;
    const settle = interpolate(t, [active.start, inEnd], [rotation + 10, rotation], clamp);
    const fadeIn = t < active.start ? 0 : interpolate(t, [active.start, active.start + 0.2], [0, 1], clamp);
    const fadeOut = t > active.end - 0.3 ? interpolate(t, [active.end - 0.3, active.end], [1, 0], clamp) : 1;
    card = {src: active.src, rotation: settle, opacity: Math.min(fadeIn, fadeOut)};
  }

  return (
    <AbsoluteFill style={{backgroundColor: meta.background}}>
      <Audio
        src={staticFile(meta.audio.replace(/^\.\//, ''))}
        volume={(f) => interpolate(f, [audioFadeStart, durationInFrames - 1], [1, 0], clamp)}
      />
      {card && (
        <AbsoluteFill style={{justifyContent: 'center', alignItems: 'center', opacity: card.opacity}}>
          <div
            style={{
              transform: `rotate(${card.rotation}deg)`,
              background: '#fff',
              padding: Math.round(safeWidth * 0.03),
              borderRadius: Math.round(4 * scale),
              boxShadow: '0 14px 36px rgba(10, 12, 16, 0.26)',
            }}
          >
            <img
              src={toStatic(card.src)}
              alt=""
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
      )}
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
      {whiteFade > 0 ? <AbsoluteFill style={{backgroundColor: meta.background, opacity: whiteFade}} /> : null}
    </AbsoluteFill>
  );
};
