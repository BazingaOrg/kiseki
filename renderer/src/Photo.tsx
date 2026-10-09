import React from 'react';
import {AbsoluteFill, interpolate, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import {ExifPanel} from './ExifPanel';
import {FramedPhoto} from './FramedPhoto';
import {PhotoCaption} from './PhotoCaption';
import {Signature, getSignatureDisplayWidth, type SignatureData} from './Signature';
import {CAPTION_BAND_PAD, CAPTION_SUBJECT_GAP, signaturePhotoLift} from './photoCaptionLayout.mjs';
import {resolveFontFamily} from './fontFamily';
import {STILL, getExifLayout, getVisualScale, signaturePathProps, type FontFamily, type Palette} from './theme';
import {getFadeDuration} from './transition';
import {motionTransform} from './motion';
import {childOpacityForParent} from './compositionTiming';
import type {TemplateMotion} from './templates';
import type {PhotoClip} from './types';

const clamp = {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'} as const;

const toStatic = (src: string) => staticFile(src.replace(/^\.\//, ''));

export const hasDisplayableExif = (exif: PhotoClip['exif']): boolean =>
  Boolean(exif && (exif.camera || exif.lens || exif.params?.length || exif.datetime));

/**
 * 单页照片:画布背景 + 居中安全框 + 中性展陈光影。
 * 新页整体淡入并覆盖仍不透明的旧页,避免两张照片同时半透明时泄漏白底。
 */
export const Photo: React.FC<{
  clip: PhotoClip;
  backgroundColor: string;
  safeWidth: number;
  safeHeight: number;
  palette: Palette;
  canvasWidth: number;
  canvasHeight: number;
  sign?: boolean;
  signature?: SignatureData | null;
  filter?: {id: string; intensity?: number} | null;
  /** 模板注入的照片运镜;缺省保持静态 */
  motion?: TemplateMotion;
  motionStart?: number;
  fontFamily?: FontFamily;
  captionOpacity?: number;
}> = ({clip, backgroundColor, safeWidth, safeHeight, palette, canvasWidth, canvasHeight, sign = false, signature, filter, motion, motionStart, fontFamily = 'serif', captionOpacity = 0}) => {
  const frame = useCurrentFrame();
  const {fps, width, height} = useVideoConfig();
  const t = frame / fps;

  const dIn = getFadeDuration(clip.transition);
  const fadeIn =
    dIn > 0
      ? interpolate(t, [clip.start - dIn / 2, clip.start + dIn / 2], [0, 1], clamp)
      : t >= clip.start
        ? 1
        : 0;
  const renderScale = getVisualScale(width, height);

  const hasExif = hasDisplayableExif(clip.exif);
  const pad = CAPTION_BAND_PAD * renderScale;
  const captionGap = CAPTION_SUBJECT_GAP * renderScale;
  const captionText = typeof clip.caption === 'string' && clip.captionLayout ? clip.caption : '';
  const captionHeight = clip.captionLayout?.height ?? 0;
  const captionBlock = captionText ? captionHeight + captionGap : 0;
  const signReserve = sign && signature && !hasExif
    ? (STILL.signature.bottomInset + STILL.signature.height) * renderScale + captionGap
    : pad;
  const maxPhotoWidth = Math.min(safeWidth, Math.max(1, canvasWidth - pad * 2));
  const maxPhotoHeight = Math.min(safeHeight, Math.max(1, canvasHeight - pad - captionBlock - signReserve));
  const lift = captionText ? 0 : signaturePhotoLift({
    canvasHeight,
    maxPhotoHeight: maxPhotoHeight,
    visualScale: renderScale,
    sign: Boolean(sign && signature),
    hasExif,
  });
  const captionNode = captionText ? (
    <PhotoCaption
      text={captionText}
      layout={clip.captionLayout}
      palette={palette}
      fontFamily={resolveFontFamily(captionText, 'zh')}
      opacity={childOpacityForParent(captionOpacity, fadeIn)}
      flow
    />
  ) : null;
  const stage = (photo: React.ReactNode) => (
    <AbsoluteFill
      style={{
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor,
        opacity: fadeIn,
        padding: pad,
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: captionText ? captionGap : 0,
          maxWidth: '100%',
          maxHeight: '100%',
        }}
      >
        {captionNode}
        {photo}
      </div>
      {sign && signature && !hasExif ? (
        <div
          style={{
            position: 'absolute',
            ...(canvasHeight > canvasWidth
              ? {left: '50%', transform: 'translateX(-50%)'}
              : {right: STILL.signature.rightInset * renderScale}),
            bottom: STILL.signature.bottomInset * renderScale,
            display: 'flex',
            color: palette.text,
            opacity: STILL.signature.opacity,
          }}
        >
          <Signature
            data={signature}
            style={{
              width: getSignatureDisplayWidth(signature, STILL.signature.height * renderScale, canvasWidth * STILL.signature.maxWidthRatio),
              height: STILL.signature.height * renderScale,
            }}
            pathProps={signaturePathProps}
          />
        </div>
      ) : null}
    </AbsoluteFill>
  );

  // 运镜包一层 transform:无 motion 时原样返回 FramedPhoto,输出逐字节不变。
  // 缩放带着相框与阴影一起走,克制的 6% 推近下观感自然,也省去图内裁切复杂度。
  const Framed = ({maxWidth, maxHeight}: {maxWidth: number; maxHeight: number}) => {
    const framed = (
      <FramedPhoto
        src={toStatic(clip.src)}
        maxWidth={maxWidth}
        maxHeight={maxHeight}
        renderScale={renderScale}
        palette={palette}
        filter={filter}
      />
    );
    let node = framed;
    if (motion) {
      const {scale, x, y} = motionTransform({
        motion,
        src: clip.src,
        t,
        start: motionStart ?? clip.start,
        end: clip.end,
        safeWidth,
        safeHeight,
      });
      node = <div style={{transform: `translate(${x}px, ${y}px) scale(${scale})`}}>{framed}</div>;
    }
    if (lift) {
      node = <div style={{display: 'inline-flex', transform: `translateY(${-lift}px)`}}>{node}</div>;
    }
    return node;
  };

  if (hasExif) {
    const layout = getExifLayout(canvasWidth, canvasHeight);
    const stacked = layout.stacked;
    const panelEstimate = stacked ? canvasHeight * 0.22 : 0;
    const photoMaxHeight = stacked
      ? Math.min(layout.photoMaxHeight, Math.max(1, maxPhotoHeight - layout.gap - panelEstimate))
      : Math.min(layout.photoMaxHeight, maxPhotoHeight);
    return stage(
      <div
        style={{
          display: 'flex',
          flexDirection: stacked ? 'column' : 'row',
          alignItems: 'center',
          gap: layout.gap,
          maxWidth: '100%',
          maxHeight: '100%',
        }}
      >
        <Framed
          maxWidth={Math.min(layout.photoMaxWidth, maxPhotoWidth)}
          maxHeight={photoMaxHeight}
        />
        <ExifPanel exif={clip.exif!} scale={renderScale} width={Math.min(layout.panelWidth, maxPhotoWidth)} sign={sign} signature={signature ?? null} palette={palette} fontFamily={fontFamily} align={stacked ? 'center' : 'left'} />
      </div>,
    );
  }

  return stage(
    <Framed maxWidth={maxPhotoWidth} maxHeight={maxPhotoHeight} />,
  );
};
