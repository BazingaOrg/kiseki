import React from 'react';
import {Img, cancelRender, continueRender, delayRender, random, useCurrentFrame} from 'remotion';
import {develop, effectiveStrength, getRoll, grainOverlay, grainScale} from '../../film/src/index.mjs';
import type {PhotoFilm} from './types';

export type GrainMode = 'baked' | 'live';

const GRAIN_TILE = 384;
const GRAIN_VARIANTS = 6;

type Developed = {url: string; width: number; height: number};

const developed = new Map<string, Promise<Developed>>();
const grainTiles = new Map<string, string[]>();

const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`照片读取失败: ${src}`));
    image.src = src;
  });

const canvasBlobUrl = (canvas: HTMLCanvasElement, type: string) =>
  new Promise<string>((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(URL.createObjectURL(blob)) : reject(new Error('胶片冲洗失败'))), type, 0.95);
  });

const developToUrl = async (src: string, film: PhotoFilm, limit: number, grain: boolean): Promise<Developed> => {
  const image = await loadImage(src);
  const fit = Math.min(1, limit / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * fit));
  const height = Math.max(1, Math.round(image.naturalHeight * fit));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', {willReadFrequently: true});
  if (!context) throw new Error('胶片冲洗失败');
  context.drawImage(image, 0, 0, width, height);
  const source = context.getImageData(0, 0, width, height);
  const result = develop(source, {
    roll: film.roll,
    strength: film.strength,
    sourceLook: film.sourceLook,
    date: film.date,
    seed: film.seed,
    grain,
  });
  source.data.set(result.data);
  context.putImageData(source, 0, 0);
  return {url: await canvasBlobUrl(canvas, 'image/png'), width, height};
};

const developedUrl = (src: string, film: PhotoFilm, limit: number, grain: boolean) => {
  const key = JSON.stringify([src, film, Math.round(limit), grain]);
  let pending = developed.get(key);
  if (!pending) {
    pending = developToUrl(src, film, limit, grain);
    developed.set(key, pending);
  }
  return pending;
};

const grainAmount = (film: PhotoFilm) => {
  const roll = getRoll(film.roll);
  if (!roll) return 0;
  return roll.effects.grain * effectiveStrength(roll.id, film.strength, film.sourceLook).effects;
};

const grainTileUrls = (film: PhotoFilm, photoHeight: number) => {
  const roll = getRoll(film.roll)!;
  const scale = grainScale(photoHeight, roll.effects.grainSize);
  const amount = grainAmount(film);
  const key = JSON.stringify([roll.id, amount, Math.round(scale * 100)]);
  const cached = grainTiles.get(key);
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  canvas.width = GRAIN_TILE;
  canvas.height = GRAIN_TILE;
  const context = canvas.getContext('2d')!;
  const urls = Array.from({length: GRAIN_VARIANTS}, (_, index) => {
    const tile = grainOverlay(GRAIN_TILE, GRAIN_TILE, {
      amount,
      color: roll.effects.grainColor,
      seed: film.seed + index * 101,
      scale,
    });
    const pixels = context.createImageData(GRAIN_TILE, GRAIN_TILE);
    pixels.data.set(tile.data);
    context.putImageData(pixels, 0, 0);
    return canvas.toDataURL('image/png');
  });
  grainTiles.set(key, urls);
  return urls;
};

export const useFilmImage = (src: string, film: PhotoFilm | null | undefined, limit: number, grain: GrainMode) => {
  const [image, setImage] = React.useState<Developed | null>(null);
  const filmKey = film ? JSON.stringify(film) : '';
  React.useLayoutEffect(() => {
    if (!film) {
      setImage(null);
      return;
    }
    const handle = delayRender(`冲洗胶片 ${src}`);
    let pending = true;
    const release = () => {
      if (!pending) return;
      pending = false;
      continueRender(handle);
    };
    developedUrl(src, film, limit, grain === 'baked')
      .then((next) => {
        if (pending) setImage(next);
        release();
      })
      .catch((error) => cancelRender(error));
    return release;
  }, [src, filmKey, limit, grain]);
  return image;
};

const displayHeight = (image: Developed, style: React.CSSProperties) => {
  if (typeof style.height === 'number') return style.height;
  const maxWidth = typeof style.maxWidth === 'number' ? style.maxWidth : Infinity;
  const maxHeight = typeof style.maxHeight === 'number' ? style.maxHeight : Infinity;
  return image.height * Math.min(1, maxWidth / image.width, maxHeight / image.height);
};

const FilmGrain: React.FC<{film: PhotoFilm; photoHeight: number}> = ({film, photoHeight}) => {
  const frame = useCurrentFrame();
  if (grainAmount(film) <= 0.001) return null;
  const urls = grainTileUrls(film, photoHeight);
  const ox = Math.floor(random(`grain-x-${film.seed}-${frame}`) * GRAIN_TILE);
  const oy = Math.floor(random(`grain-y-${film.seed}-${frame}`) * GRAIN_TILE);
  return (
    <span
      aria-hidden
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        backgroundImage: `url(${urls[frame % urls.length]})`,
        backgroundSize: `${GRAIN_TILE}px ${GRAIN_TILE}px`,
        backgroundPosition: `${ox}px ${oy}px`,
        mixBlendMode: 'overlay',
      }}
    />
  );
};

export const FilmImg: React.FC<{
  src: string;
  film?: PhotoFilm | null;
  grain?: GrainMode;
  style: React.CSSProperties;
  wrapperStyle?: React.CSSProperties;
}> = ({src, film, grain = 'live', style, wrapperStyle}) => {
  const limit = Math.ceil(Math.max(Number(style.maxWidth) || 0, Number(style.maxHeight) || 0, Number(style.height) || 0) * 1.5) || 2048;
  const image = useFilmImage(src, film, limit, grain);
  if (!film) return <Img src={src} style={style} />;
  if (!image) return null;
  if (grain !== 'live') return <Img src={image.url} style={style} />;
  return (
    <span style={{position: 'relative', display: 'inline-flex', ...wrapperStyle}}>
      <Img src={image.url} style={style} />
      <FilmGrain film={film} photoHeight={displayHeight(image, style)} />
    </span>
  );
};
