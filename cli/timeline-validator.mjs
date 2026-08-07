/**
 * Timeline 的渲染前边界检查.它有意不是 JSON Schema:只验证当前渲染器消费的
 * 字段,不改写输入,也不拒绝未知 kind,以便新版 planner 产物仍可被旧 CLI 透传.
 */
export class TimelineValidationError extends Error {
  constructor(path, message) {
    super(`timeline ${path}: ${message}`);
    this.name = 'TimelineValidationError';
  }
}

const fail = (path, message) => { throw new TimelineValidationError(path, message); };
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const object = (value, path) => {
  if (!isObject(value)) fail(path, '必须是对象');
  return value;
};
const array = (value, path) => {
  if (!Array.isArray(value)) fail(path, '必须是数组');
  return value;
};
const string = (value, path) => {
  if (typeof value !== 'string') fail(path, '必须是字符串');
  return value;
};
const boolean = (value, path) => {
  if (typeof value !== 'boolean') fail(path, '必须是布尔值');
  return value;
};
const finite = (value, path, {positive = false, nonNegative = false, integer = false} = {}) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(path, '必须是有限数字');
  if (positive && value <= 0) fail(path, '必须是正数');
  if (nonNegative && value < 0) fail(path, '不能为负数');
  if (integer && !Number.isInteger(value)) fail(path, '必须是整数');
  return value;
};

const validateFilter = (value, path) => {
  if (value === null) return;
  const filter = object(value, path);
  if (string(filter.id, `${path}.id`).length === 0) fail(`${path}.id`, '不能为空');
  if ('intensity' in filter) {
    const intensity = finite(filter.intensity, `${path}.intensity`);
    if (intensity < 0 || intensity > 1) fail(`${path}.intensity`, '必须在 0 到 1 之间');
  }
};

const validateClipBounds = (clip, path, duration) => {
  const start = finite(clip.start, `${path}.start`, {nonNegative: true});
  const end = finite(clip.end, `${path}.end`, {nonNegative: true});
  if (end <= start) fail(`${path}.end`, '必须大于 start');
  if (end > duration) fail(`${path}.end`, '不能超过 $.meta.duration');
};

const validateTransition = (value, path) => {
  const transition = object(value, path);
  const type = string(transition.type, `${path}.type`);
  if (!['album', 'crossfade', 'cut', 'none'].includes(type)) fail(`${path}.type`, '必须是 album、crossfade、cut 或 none');
  const duration = finite(transition.duration, `${path}.duration`, {nonNegative: true});
  if ((type === 'cut' || type === 'none') && duration !== 0) fail(`${path}.duration`, `${type} 的 duration 必须为 0`);
};

const validateMotion = (value, path) => {
  const motion = object(value, path);
  const type = string(motion.type, `${path}.type`);
  if (!['kenburns', 'none'].includes(type)) fail(`${path}.type`, '必须是 kenburns 或 none');
  finite(motion.from, `${path}.from`, {positive: true});
  finite(motion.to, `${path}.to`, {positive: true});
};

/** @param {unknown} timeline @returns {unknown} the original input, unchanged */
export const validateTimeline = (timeline) => {
  const root = object(timeline, '$');
  const meta = object(root.meta, '$.meta');
  finite(meta.version, '$.meta.version', {positive: true, integer: true});
  const duration = finite(meta.duration, '$.meta.duration', {positive: true});
  string(meta.audio, '$.meta.audio');
  finite(meta.width, '$.meta.width', {positive: true, integer: true});
  finite(meta.height, '$.meta.height', {positive: true, integer: true});
  finite(meta.fps, '$.meta.fps', {positive: true, integer: true});
  string(meta.background, '$.meta.background');
  finite(meta.photo_scale, '$.meta.photo_scale', {positive: true});

  if ('sign' in meta) boolean(meta.sign, '$.meta.sign');
  if ('filter' in meta) validateFilter(meta.filter, '$.meta.filter');
  if ('trim' in meta) {
    const trim = object(meta.trim, '$.meta.trim');
    if (!['auto', 'full', 'seconds'].includes(string(trim.mode, '$.meta.trim.mode'))) fail('$.meta.trim.mode', '必须是 auto、full 或 seconds');
    boolean(trim.applied, '$.meta.trim.applied');
    const fullDuration = finite(trim.full_duration, '$.meta.trim.full_duration', {positive: true});
    const trimmedDuration = finite(trim.trimmed_duration, '$.meta.trim.trimmed_duration', {positive: true});
    if (trimmedDuration > fullDuration) fail('$.meta.trim.trimmed_duration', '不能超过 $.meta.trim.full_duration');
  }
  if ('chapters' in meta) {
    const chapters = object(meta.chapters, '$.meta.chapters');
    boolean(chapters.enabled, '$.meta.chapters.enabled');
    finite(chapters.day_count, '$.meta.chapters.day_count', {nonNegative: true, integer: true});
    finite(chapters.card_count, '$.meta.chapters.card_count', {nonNegative: true, integer: true});
  }
  if ('branding' in meta) {
    const branding = object(meta.branding, '$.meta.branding');
    if ('outro_text' in branding) string(branding.outro_text, '$.meta.branding.outro_text');
    if ('signature' in branding) string(branding.signature, '$.meta.branding.signature');
    if ('intro' in branding) boolean(branding.intro, '$.meta.branding.intro');
  }

  const photos = array(root.photos, '$.photos');
  photos.forEach((value, index) => {
    const path = `$.photos[${index}]`;
    const clip = object(value, path);
    // kind 省略是旧版照片;未知 string kind 则由 Diary 忽略,保留前向兼容.
    if (clip.kind !== undefined && clip.kind !== 'photo' && clip.kind !== 'chapter') return;
    validateClipBounds(clip, path, duration);
    if (clip.kind === 'chapter') {
      string(clip.text, `${path}.text`);
      return;
    }
    if (string(clip.src, `${path}.src`).length === 0) fail(`${path}.src`, '不能为空');
    if ('transition' in clip) validateTransition(clip.transition, `${path}.transition`);
    if ('motion' in clip) validateMotion(clip.motion, `${path}.motion`);
    if ('filter' in clip) validateFilter(clip.filter, `${path}.filter`);
  });

  array(root.subtitles, '$.subtitles').forEach((value, index) => {
    const path = `$.subtitles[${index}]`;
    const line = object(value, path);
    string(line.text, `${path}.text`);
    if (!['ja', 'zh', 'en', 'mixed'].includes(string(line.lang, `${path}.lang`))) fail(`${path}.lang`, '必须是 ja、zh、en 或 mixed');
    validateClipBounds(line, path, duration);
    finite(line.confidence, `${path}.confidence`);
  });

  if ('beats' in root) {
    const beats = object(root.beats, '$.beats');
    finite(beats.bpm, '$.beats.bpm', {positive: true});
    array(beats.downbeats, '$.beats.downbeats').forEach((beat, index) => finite(beat, `$.beats.downbeats[${index}]`, {nonNegative: true}));
  }
  return timeline;
};
