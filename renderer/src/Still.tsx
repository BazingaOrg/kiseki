import React from 'react';
import {AbsoluteFill, staticFile} from 'remotion';
import {ensureFonts} from './fonts';
import {ExifPanel, type StillExif} from './ExifPanel';
import {FramedPhoto} from './FramedPhoto';
import {Signature, getSignatureDisplayWidth, useSignatureData} from './Signature';
import {PhotoCaption} from './PhotoCaption';
import {CAPTION_BAND_PAD, CAPTION_SUBJECT_GAP, signaturePhotoLift} from './photoCaptionLayout.mjs';
import {resolveFontFamily} from './fontFamily';
import {CANVAS, STILL, getExifLayout, getPalette, getVisualScale, signaturePathProps} from './theme';

export type {StillExif} from './ExifPanel';

export type StillProps = {
  src: string;
  background: string;
  photoScale: number;
  width: number;
  height: number;
  exif?: StillExif | null;
  sign?: boolean;
  signatureSrc?: string;
  filter?: {id: string; intensity?: number} | null;
  caption?: string | null;
  captionLayout?: {
    x: number;
    y: number;
    width: number;
    height: number;
    fontSize: number;
    letterSpacing: string;
  } | null;
};

const toStatic = (src: string) => staticFile(src.replace(/^\.\//, ''));

/**
 * 静态导出 composition:与视频同款展陈框;可选 EXIF 展签(照片左 + 信息右,整体居中)。
 */
export const Still: React.FC<StillProps> = ({
  src,
  background,
  photoScale,
  width,
  height,
  exif,
  sign = false,
  signatureSrc,
  filter,
  caption,
  captionLayout,
}) => {
  ensureFonts('serif');
  const scale = getVisualScale(width, height);
  const palette = getPalette(background);
  const signature = useSignatureData(sign ? signatureSrc : undefined);
  const hasExif = Boolean(exif && (exif.camera || exif.lens || exif.params || exif.datetime));
  const pad = CAPTION_BAND_PAD * scale;
  const captionGap = CAPTION_SUBJECT_GAP * scale;
  const hasCaption = Boolean(caption && captionLayout);
  const captionBlock = hasCaption ? captionLayout!.height + captionGap : 0;
  const signReserve = sign && signature && !hasExif
    ? (STILL.signature.bottomInset + STILL.signature.height) * scale + captionGap
    : pad;
  const maxPhotoWidth = Math.max(1, width - pad * 2);
  const maxPhotoHeight = Math.max(1, height - pad - captionBlock - signReserve);
  const captionNode = hasCaption ? (
    <PhotoCaption
      text={caption!}
      layout={captionLayout}
      palette={palette}
      fontFamily={resolveFontFamily(caption!, 'zh')}
      flow
    />
  ) : null;
  const stage = (photo: React.ReactNode) => (
    <AbsoluteFill
      style={{
        backgroundColor: background,
        justifyContent: 'center',
        alignItems: 'center',
        padding: pad,
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: hasCaption ? captionGap : 0,
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
            ...(height > width
              ? {left: '50%', transform: 'translateX(-50%)'}
              : {right: STILL.signature.rightInset * scale}),
            bottom: STILL.signature.bottomInset * scale,
            display: 'flex',
            color: palette.text,
            opacity: STILL.signature.opacity,
          }}
        >
          <Signature
            data={signature}
            style={{
              width: getSignatureDisplayWidth(signature, STILL.signature.height * scale, width * STILL.signature.maxWidthRatio),
              height: STILL.signature.height * scale,
            }}
            pathProps={signaturePathProps}
          />
        </div>
      ) : null}
    </AbsoluteFill>
  );

  if (!hasExif) {
    const safeW = Math.min(width * photoScale, maxPhotoWidth);
    const safeH = Math.min(height * photoScale, maxPhotoHeight);
    const lift = hasCaption ? 0 : signaturePhotoLift({
      canvasHeight: height,
      maxPhotoHeight: safeH,
      visualScale: scale,
      sign: Boolean(sign && signature),
      hasExif: false,
    });
    return stage(
      <div style={{display: 'inline-flex', transform: lift ? `translateY(${-lift}px)` : undefined}}>
        <FramedPhoto src={toStatic(src)} maxWidth={safeW} maxHeight={safeH} renderScale={scale} palette={palette} filter={filter} />
      </div>,
    );
  }

  const layout = getExifLayout(width, height);
  const stacked = layout.stacked;
  const panelEstimate = stacked ? height * 0.22 : 0;
  const photoMaxHeight = stacked
    ? Math.min(layout.photoMaxHeight, Math.max(1, maxPhotoHeight - layout.gap - panelEstimate))
    : Math.min(layout.photoMaxHeight, maxPhotoHeight);
  const photoMaxWidth = Math.min(layout.photoMaxWidth, maxPhotoWidth);

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
      <FramedPhoto
        src={toStatic(src)}
        maxWidth={photoMaxWidth}
        maxHeight={photoMaxHeight}
        renderScale={scale}
        palette={palette}
        filter={filter}
      />
      <ExifPanel exif={exif!} scale={scale} width={Math.min(layout.panelWidth, maxPhotoWidth)} sign={sign} signature={signature} palette={palette} align={stacked ? 'center' : 'left'} />
    </div>,
  );
};

export const defaultStillProps: StillProps = {
  src: 'photos/001.jpg',
  background: CANVAS.background,
  photoScale: 0.8,
  width: CANVAS.width,
  height: CANVAS.height,
  exif: {
    camera: 'Sony α7 IV',
    lens: 'FE 35mm F1.8',
    params: ['45mm', 'f/22', '1/75s', 'ISO 200'],
    datetime: '2026.05.21 18:42',
  },
};
