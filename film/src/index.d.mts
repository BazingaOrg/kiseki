export type Rgb = [number, number, number];

export interface ColorParams {
  exp: number;
  temp: number;
  tint: number;
  con: number;
  piv: number;
  black: number;
  white: number;
  sat: number;
  satSh: number;
  satHi: number;
  shT: Rgb;
  hiT: Rgb;
  hueS: number[];
  hueH: number[];
  hueL: number[];
  mono: number;
  monoMix: Rgb;
  monoTone: Rgb;
}

export interface RollEffects {
  grain: number;
  grainSize: number;
  grainColor: number;
  halation: number;
  halationColor: Rgb;
  bloom: number;
  vignette: number;
  flash: number;
}

export type Maker = 'fujifilm' | 'ricoh' | 'leica' | 'kodak' | 'cinestill' | 'toy';

export interface Roll {
  id: string;
  name: string;
  maker: Maker;
  ref: string;
  desc: string;
  tags: string[];
  fidelity: 'measured' | 'approximate';
  stamp: boolean;
  lut: string | null;
  color: Partial<ColorParams>;
  effects: RollEffects;
}

export interface SourceLook {
  maker: 'fujifilm';
  label: string;
  roll: string | null;
}

export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export interface Lut {
  size: number;
  data: Float32Array;
}

export interface EncodedLut {
  size: number;
  data: string;
}

export interface DevelopOptions {
  roll: string;
  strength?: number;
  sourceLook?: SourceLook | null;
  grain?: boolean;
  seed?: number;
  date?: string | number | Date | null;
}

export declare const FILM_ENGINE_VERSION: number;
export declare const NEUTRAL_COLOR: Readonly<ColorParams>;
export declare const ROLLS: readonly Roll[];
export declare const ROLL_IDS: readonly string[];
export declare const SCENE_TAGS: readonly string[];
export declare const MOOD_TAGS: readonly string[];
export declare const MAKERS: Readonly<Record<Maker, string>>;
export declare const STYLED_SOURCE_STRENGTH: number;

export declare function getRoll(id: string): Roll | null;
export declare function isRollId(id: unknown): id is string;
export declare function makerLabel(roll: Roll): string;
export declare function develop(image: RgbaImage, options: DevelopOptions): RgbaImage;
export declare function lutForRoll(roll: Roll): Lut;
export declare function createColorTransform(params: Partial<ColorParams>): (r: number, g: number, b: number, out: number[]) => number[];
export declare function srgbToLinear(x: number): number;
export declare function linearToSrgb(x: number): number;
export declare function bakeLut(transform: (r: number, g: number, b: number, out: number[]) => number[], size?: number): Lut;
export declare function sampleLut(lut: Lut, r: number, g: number, b: number, out: number[]): number[];
export declare function parseCube(text: string): Lut;
export declare function formatCube(lut: Lut, title: string): string;
export declare function encodeLut(lut: Lut): EncodedLut;
export declare function decodeLut(encoded: EncodedLut): Lut;
export declare function grainScale(height: number, size: number): number;
export declare function grainSample(x: number, y: number, scale: number, seed: number): number;
export declare function grainOverlay(width: number, height: number, options: {amount: number; size?: number; color?: number; seed?: number; scale?: number}): RgbaImage;
export declare function detectSourceLook(makerNote: Uint8Array | null | undefined): SourceLook | null;
export declare function effectiveStrength(rollId: string, strength: number, sourceLook: SourceLook | null): {color: number; effects: number; reason: 'same' | 'styled' | null};
export declare function stampText(date: string | number | Date): string | null;
export declare function drawStamp(image: RgbaImage, text: string | null): RgbaImage;
