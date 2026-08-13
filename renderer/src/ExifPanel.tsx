import React from 'react';
import {Signature, type SignatureData} from './Signature';
import {FONT_FAMILY, STILL, type FontFamily, type Palette} from './theme';

export type StillExif = {
  camera?: string;
  lens?: string;
  params?: string[];
  datetime?: string;
};

export const ExifPanel: React.FC<{exif: StillExif; scale: number; width: number; sign: boolean; signature: SignatureData | null; palette: Palette; fontFamily?: FontFamily}> = ({
  exif,
  scale,
  width,
  sign,
  signature,
  palette,
  fontFamily = 'serif',
}) => {
  const t = STILL.typography;
  const face = FONT_FAMILY[fontFamily].mixed;
  const line = (text: string | undefined, fontSize: number, color: string, weight = 500) =>
    text ? (
      <div
        style={{
          fontFamily: face,
          fontSize: fontSize * scale,
          fontWeight: weight,
          letterSpacing: t.letterSpacing,
          color,
          lineHeight: 1.35,
          marginBottom: t.lineGap * scale,
        }}
      >
        {text}
      </div>
    ) : null;

  return (
    <div
      style={{
        width,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        textAlign: 'left',
      }}
    >
      {line(exif.camera, t.cameraFontSize, palette.text)}
      {line(exif.lens, t.lensFontSize, palette.text)}
      {(exif.camera || exif.lens) && (exif.params || exif.datetime) ? (
        <div style={{height: t.groupGap * scale}} />
      ) : null}
      {exif.params?.length ? (
        <>
          <div style={{width: `${t.dividerWidth * 100}%`, height: scale, background: palette.divider, marginBottom: t.groupGap * scale}} />
          {exif.params.map((param) => (
            <div key={param} style={{fontFamily: face, fontSize: t.paramsFontSize * scale, fontWeight: 500, letterSpacing: t.letterSpacing, color: palette.text, lineHeight: 1.2, marginBottom: t.paramsLineGap * scale}}>{param}</div>
          ))}
        </>
      ) : null}
      {(exif.params && exif.datetime) || ((exif.camera || exif.lens) && exif.datetime) ? (
        <div style={{height: t.groupGap * scale}} />
      ) : null}
      {line(exif.datetime, t.datetimeFontSize, palette.secondaryText, 400)}
      {sign && signature ? (
        <div style={{marginTop: t.groupGap * scale, color: palette.text, opacity: STILL.signature.opacity}}>
          <Signature data={signature} style={{height: STILL.signature.panelHeight * scale, maxWidth: width}} pathProps={{fill: 'currentColor'}} />
        </div>
      ) : null}
    </div>
  );
};
