import React from 'react';
import {AbsoluteFill, interpolate, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import {ExifPanel} from './ExifPanel';
import {FramedPhoto} from './FramedPhoto';
import {Signature, getSignatureDisplayWidth, type SignatureData} from './Signature';
import {STILL, getExifLayout, getVisualScale, type FontFamily, type Palette} from './theme';
import {getFadeDuration} from './transition';
import {motionTransform} from './motion';
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
  fontFamily?: FontFamily;
}> = ({clip, backgroundColor, safeWidth, safeHeight, palette, canvasWidth, canvasHeight, sign = false, signature, filter, motion, fontFamily = 'serif'}) => {
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
    if (!motion) return framed;
    const {scale, x, y} = motionTransform({
      motion,
      src: clip.src,
      t,
      start: clip.start,
      end: clip.end,
      safeWidth,
      safeHeight,
    });
    return <div style={{transform: `translate(${x}px, ${y}px) scale(${scale})`}}>{framed}</div>;
  };

  // 带 EXIF 展签:照片左 + 展签右,整体居中,与 Still withExif 分支同款布局
  if (hasExif) {
    const layout = getExifLayout(canvasWidth, canvasHeight);
    return (
      <AbsoluteFill
        style={{
          justifyContent: 'center',
          alignItems: 'center',
          backgroundColor,
          opacity: fadeIn,
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: layout.stacked ? 'column' : 'row',
            alignItems: 'center',
            gap: layout.gap,
            maxWidth: '100%',
            maxHeight: '100%',
          }}
        >
          <Framed
            maxWidth={layout.photoMaxWidth}
            maxHeight={layout.photoMaxHeight}
            />
          <ExifPanel exif={clip.exif!} scale={renderScale} width={layout.panelWidth} sign={sign} signature={signature ?? null} palette={palette} fontFamily={fontFamily} />
        </div>
      </AbsoluteFill>
    );
  }

  // 无展签但开启签名落款:退居画布右下角,并为字幕预留安全区
  if (sign && signature) {
    const signatureHeight = STILL.signature.height * renderScale;
    const signatureWidth = getSignatureDisplayWidth(
      signature,
      signatureHeight,
      canvasWidth * STILL.signature.maxWidthRatio,
    );
    return (
      <AbsoluteFill
        style={{
          justifyContent: 'center',
          alignItems: 'center',
          backgroundColor,
          opacity: fadeIn,
        }}
      >
        <Framed
          maxWidth={safeWidth}
          maxHeight={safeHeight}
          />
        {/* 视频底部中线让给字幕带,落款按摄影钤印惯例退居右下(still 无字幕,维持居中,Still.tsx 不动) */}
        <div
          style={{
            position: 'absolute',
            right: STILL.signature.rightInset * renderScale,
            bottom: STILL.signature.bottomInset * renderScale,
            display: 'flex',
            color: palette.text,
            opacity: STILL.signature.opacity,
          }}
        >
          <Signature data={signature} style={{width: signatureWidth, height: signatureHeight}} pathProps={{fill: 'currentColor'}} />
        </div>
      </AbsoluteFill>
    );
  }

  return (
    <AbsoluteFill
      style={{
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor,
        opacity: fadeIn,
      }}
    >
      <Framed
        maxWidth={safeWidth}
        maxHeight={safeHeight}
        />
    </AbsoluteFill>
  );
};
