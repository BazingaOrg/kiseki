export const DEFAULT_OUTRO_TEXT = 'Thanks for watching :)';
export const MAX_OUTRO_LENGTH = 80;
export const GENERATED_SIGNATURE_REL = 'output/metadata/generated-signature.svg';
export const INTRO_MIN_TOTAL = 5.95;

export const outroTextError = (value) => {
  if (typeof value !== 'string') return '片尾文字需要是文字';
  if (value.includes('\n') || value.includes('\r')) return '片尾文字不能换行';
  if (value.trim().length > MAX_OUTRO_LENGTH) return `片尾文字最多 ${MAX_OUTRO_LENGTH} 个字符`;
  return null;
};

export const normalizeOutroText = (value) => {
  const error = outroTextError(value);
  if (error) throw new Error(error);
  return value.trim();
};

export const effectiveOutroText = (explicitKeys, values) =>
  explicitKeys.has('outro_text') ? values.outro_text : DEFAULT_OUTRO_TEXT;

export const signaturePathError = (value) => {
  if (typeof value !== 'string' || !value.trim()) return '签名文件路径不能为空';
  const rel = value.trim().replace(/^\.\//, '');
  if (rel.startsWith('/') || /^[A-Za-z]:[\\/]/.test(rel) || rel.split(/[\\/]/).includes('..')) {
    return '签名文件必须在素材夹里';
  }
  if (!rel.toLowerCase().endsWith('.svg')) return '签名文件必须是 svg';
  return null;
};

const isPhotoClip = (clip) =>
  Boolean(clip) && (clip.kind === undefined || clip.kind === 'photo') && typeof clip.src === 'string';

export const applyBrandingOverrides = (timeline, {outroText, signature} = {}) => {
  const branding = {...(timeline.meta.branding ?? {})};
  let changed = false;
  if (outroText !== undefined) {
    branding.outro_text = normalizeOutroText(outroText);
    changed = true;
  }
  if (signature) {
    const error = signaturePathError(signature);
    if (error) throw new Error(error);
    branding.signature = signature.trim().replace(/^\.\//, '');
    branding.intro = true;
    changed = true;
    const photos = (timeline.photos ?? []).filter(isPhotoClip);
    if (photos.length > 0 && timeline.meta.duration < INTRO_MIN_TOTAL) {
      timeline.meta.duration = INTRO_MIN_TOTAL;
      const last = photos[photos.length - 1];
      if (typeof last.end === 'number' && last.end < timeline.meta.duration) last.end = timeline.meta.duration;
    }
  }
  if (changed) timeline.meta.branding = branding;
  return timeline;
};
