import React from 'react';
import {AbsoluteFill, staticFile} from 'remotion';
import {ensureFonts} from './fonts';
import {ExifPanel, type StillExif} from './ExifPanel';
import {FramedPhoto} from './FramedPhoto';
import {Signature, useSignatureData} from './Signature';
import {PhotoCaption} from './PhotoCaption';
import {STILL_CAPTION_RESERVE, STILL_CAPTION_SIGN_LIFT} from './photoCaptionLayout.mjs';
import {resolveFontFamily} from './fontFamily';
import {CANVAS, STILL, getExifLayout, getPalette, getVisualScale} from './theme';

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

  if (!hasExif) {
    const safeW = width * photoScale;
    const showCaption = Boolean(caption && captionLayout);
    const captionReserve = showCaption ? STILL_CAPTION_RESERVE * scale : 0;
    const safeH = height * photoScale - captionReserve;
    const lift = showCaption && sign ? STILL_CAPTION_SIGN_LIFT * scale : 0;
    return (
      <AbsoluteFill
        style={{
          backgroundColor: background,
          justifyContent: 'center',
          alignItems: 'center',
        }}
      >
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: showCaption ? 24 * scale : 0,
          transform: lift ? `translateY(-${lift}px)` : undefined,
        }}>
          <FramedPhoto src={toStatic(src)} maxWidth={safeW} maxHeight={Math.max(0, safeH)} renderScale={scale} palette={palette} filter={filter} />
          {showCaption ? (
            <PhotoCaption
              text={caption ?? ''}
              layout={captionLayout}
              palette={palette}
              fontFamily={resolveFontFamily(caption ?? '', 'zh')}
              flow
            />
          ) : null}
        </div>
        {sign && signature ? (
          <div style={{position: 'absolute', left: 0, right: 0, bottom: STILL.signature.bottomInset * scale, display: 'flex', justifyContent: 'center', color: palette.text, opacity: STILL.signature.opacity}}>
            <Signature data={signature} style={{height: STILL.signature.height * scale, maxWidth: safeW}} pathProps={{fill: 'currentColor'}} />
          </div>
        ) : null}
      </AbsoluteFill>
    );
  }

  const layout = getExifLayout(width, height);

  return (
    <AbsoluteFill
      style={{
        backgroundColor: background,
        justifyContent: 'center',
        alignItems: 'center',
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
        <div style={{display: 'flex', flexDirection: 'column', alignItems: 'center', gap: caption && captionLayout ? 24 * scale : 0}}>
          <FramedPhoto
            src={toStatic(src)}
            maxWidth={layout.photoMaxWidth}
            maxHeight={caption && captionLayout ? layout.photoMaxHeight - STILL_CAPTION_RESERVE * scale : layout.photoMaxHeight}
            renderScale={scale}
            palette={palette}
            filter={filter}
          />
          {caption && captionLayout ? (
            <PhotoCaption
              text={caption}
              layout={captionLayout}
              palette={palette}
              fontFamily={resolveFontFamily(caption, 'zh')}
              flow
            />
          ) : null}
        </div>
        <ExifPanel exif={exif!} scale={scale} width={layout.panelWidth} sign={sign} signature={signature} palette={palette} />
      </div>
    </AbsoluteFill>
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
