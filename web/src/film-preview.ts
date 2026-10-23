import {develop, filmSeedFor} from '../../film/src/index.mjs';
import type {SourceLook} from '../../film/src/index.mjs';

export interface PreviewRequest {
  url: string;
  roll: string | null;
  strength: number;
  sourceLook: SourceLook | null;
  grain: boolean;
  seed: number;
  date: string | null;
}

const images = new Map<string, Promise<ImageData>>();
const developed = new Map<string, Promise<string>>();
const MAX_DEVELOPED = 240;
let queue: Promise<unknown> = Promise.resolve();

const yieldToBrowser = () => new Promise((resolve) => setTimeout(resolve, 0));

const loadPixels = (url: string) => {
  let pending = images.get(url);
  if (!pending) {
    pending = new Promise<ImageData>((resolve, reject) => {
      const image = new Image();
      image.decoding = 'async';
      image.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext('2d', {willReadFrequently: true});
        if (!context) return reject(new Error('canvas unavailable'));
        context.drawImage(image, 0, 0);
        resolve(context.getImageData(0, 0, canvas.width, canvas.height));
      };
      image.onerror = () => reject(new Error('image failed'));
      image.src = url;
    });
    pending.catch(() => images.delete(url));
    images.set(url, pending);
  }
  return pending;
};

const toObjectUrl = async (pixels: ImageData) => {
  const canvas = document.createElement('canvas');
  canvas.width = pixels.width;
  canvas.height = pixels.height;
  canvas.getContext('2d')!.putImageData(pixels, 0, 0);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
  if (!blob) throw new Error('encode failed');
  return URL.createObjectURL(blob);
};

const run = async (request: PreviewRequest) => {
  const source = await loadPixels(request.url);
  await yieldToBrowser();
  const result = develop(source, {
    roll: request.roll!,
    strength: request.strength,
    sourceLook: request.sourceLook,
    grain: request.grain,
    seed: request.seed,
    date: request.date,
  });
  const pixels = new ImageData(source.width, source.height);
  pixels.data.set(result.data);
  return toObjectUrl(pixels);
};

export const developPreview = (request: PreviewRequest): Promise<string> => {
  if (!request.roll || request.strength <= 0) return Promise.resolve(request.url);
  const key = JSON.stringify(request);
  const cached = developed.get(key);
  if (cached) {
    developed.delete(key);
    developed.set(key, cached);
    return cached;
  }
  const pending = queue.then(() => run(request));
  queue = pending.catch(() => undefined);
  pending.catch(() => developed.delete(key));
  developed.set(key, pending);
  if (developed.size > MAX_DEVELOPED) {
    const [oldestKey, oldest] = developed.entries().next().value!;
    developed.delete(oldestKey);
    oldest.then((url) => URL.revokeObjectURL(url), () => undefined);
  }
  return pending;
};

export const seedFor = (assetId: string) => filmSeedFor(assetId.replace(/^photo:/, ''));
