import path from 'node:path';

const SAFE_SUFFIX = /^[a-z0-9.-]+$/;

/** The stable suffix order shared by video and still output names. */
export const resolveOutputVariantSuffix = ({
  exif = false,
  sign = false,
  photoCaption = false,
  dark = false,
  portrait = false,
  square = false,
  draft = false,
  template = null,
  lyricsMode = 'bilingual',
} = {}) => `${exif ? '-exif' : ''}${sign ? '-sign' : ''}${photoCaption ? '-caption' : ''}${dark ? '-dark' : ''}` +
  `${portrait ? '-portrait' : ''}${square ? '-square' : ''}${draft ? '-draft' : ''}` +
  `${template && SAFE_SUFFIX.test(template) ? `-template-${template}` : ''}` +
  `${lyricsMode === 'original' ? '-lyrics-original' : lyricsMode === 'none' ? '-lyrics-none' : ''}`;

export const enumerateOutputVariantSuffixes = ({
  includeDraft = false,
  templates = [],
} = {}) => {
  const suffixes = new Set();
  for (const exif of [false, true]) {
    for (const sign of [false, true]) {
      for (const photoCaption of [false, true]) {
        for (const dark of [false, true]) {
          for (const canvas of [null, 'portrait', 'square']) {
            for (const draft of includeDraft ? [false, true] : [false]) {
              for (const template of templates.length > 0 ? [null, ...templates] : [null]) {
                suffixes.add(resolveOutputVariantSuffix({
                  exif, sign, photoCaption, dark,
                  portrait: canvas === 'portrait',
                  square: canvas === 'square',
                  draft,
                  template,
                }));
              }
            }
          }
        }
      }
    }
  }
  return [...suffixes];
};

/**
 * Pure canonical video destination resolver. Explicit -o remains authoritative;
 * only default names receive presentation, canvas, and draft suffixes.
 */
export const resolveRenderOutputPath = ({folder, output = null, ...options} = {}) =>
  path.resolve(output ?? path.join(folder, 'output', `${path.basename(folder)}${resolveOutputVariantSuffix(options)}.mp4`));
