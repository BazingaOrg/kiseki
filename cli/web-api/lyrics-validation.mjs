const normalize = (value) => String(value ?? '')
  .normalize('NFKC')
  .toLocaleLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, '');

const bigrams = (text) => {
  const value = normalize(text);
  if (value.length < 2) return value ? [value] : [];
  return Array.from({length: value.length - 1}, (_, index) => value.slice(index, index + 2));
};

const similarity = (left, right) => {
  const a = bigrams(left);
  const b = bigrams(right);
  if (a.length === 0 || b.length === 0) return 0;
  const counts = new Map();
  for (const token of a) counts.set(token, (counts.get(token) ?? 0) + 1);
  let overlap = 0;
  for (const token of b) {
    const count = counts.get(token) ?? 0;
    if (count > 0) {
      overlap += 1;
      counts.set(token, count - 1);
    }
  }
  return (2 * overlap) / (a.length + b.length);
};

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

/**
 * 用本地识别人声与候选 LRC 找时间锚点。Whisper 常把相邻几行合并，因此每个候选
 * 同时比较 1–3 行拼接；只保留高相似度且时间顺序递增的匹配。
 */
export const validateLyricsAlignment = (recognizedSegments, lrcEntries) => {
  const recognized = (Array.isArray(recognizedSegments) ? recognizedSegments : [])
    .filter((segment) => Number.isFinite(segment?.start) && normalize(segment?.text).length >= 4);
  const lyrics = (Array.isArray(lrcEntries) ? lrcEntries : [])
    .filter((entry) => Number.isFinite(entry?.time) && normalize(entry?.text).length >= 2);
  const anchors = [];
  let lyricFloor = 0;
  for (const segment of recognized) {
    let best = null;
    for (let index = lyricFloor; index < lyrics.length; index += 1) {
      // 同一首歌的重复副歌文本几乎相同。限制到相近时间窗，避免第二遍副歌被
      // 贪心匹配到第三遍；窗口仍足以覆盖常见的固定前奏偏移。
      if (Math.abs(segment.start - lyrics[index].time) > 35) continue;
      for (let size = 1; size <= 3 && index + size <= lyrics.length; size += 1) {
        const score = similarity(segment.text, lyrics.slice(index, index + size).map(({text}) => text).join(''));
        if (!best || score > best.score) best = {score, index, time: lyrics[index].time, text: lyrics[index].text};
      }
    }
    if (best?.score >= 0.5) {
      anchors.push({recognizedTime: segment.start, lyricTime: best.time, offset: segment.start - best.time, score: best.score});
      lyricFloor = best.index + 1;
    }
  }

  if (anchors.length < 4) return {status: 'inconclusive', anchors, recommendedOffset: null, spread: null};
  const offsets = anchors.map(({offset}) => offset);
  const recommendedOffset = median(offsets);
  const deviations = offsets.map((offset) => Math.abs(offset - recommendedOffset));
  const sortedOffsets = [...offsets].sort((a, b) => a - b);
  // Whisper 偶尔会把一句错配到相邻副歌；锚点足够多时裁掉两端各 10%，避免一个
  // 离群点把本来稳定的时间轴误判成不同版本。持续漂移仍会保留在核心区间里。
  const trim = Math.floor(sortedOffsets.length * 0.1);
  const coreOffsets = trim > 0 ? sortedOffsets.slice(trim, -trim) : sortedOffsets;
  const spread = Math.max(...coreOffsets) - Math.min(...coreOffsets);
  const ordered = [...anchors].sort((a, b) => a.recognizedTime - b.recognizedTime);
  const groupSize = Math.max(2, Math.floor(ordered.length / 3));
  const earlyOffset = median(ordered.slice(0, groupSize).map(({offset}) => offset));
  const lateOffset = median(ordered.slice(-groupSize).map(({offset}) => offset));
  const drift = lateOffset - earlyOffset;
  // 版本不一致的关键证据是偏移随歌曲进度持续漂移，而不是个别句子的 Whisper
  // 边界抖动。普通识别误差可能让 spread 较大，但不会让前后段中位数相差数秒。
  if (Math.abs(drift) > 5 && spread > 6) return {status: 'mismatch', anchors, recommendedOffset, spread, drift};
  return {
    status: Math.abs(recommendedOffset) <= 1.5 ? 'matched' : 'offset',
    anchors,
    recommendedOffset,
    spread,
    drift,
  };
};

export const shiftLrc = (lrc, offsetSeconds) => String(lrc ?? '').replace(
  /\[(\d+):(\d+(?:\.\d+)?)\]/g,
  (_match, minutes, seconds) => {
    const shifted = Math.max(0, Number(minutes) * 60 + Number(seconds) + offsetSeconds);
    const nextMinutes = Math.floor(shifted / 60);
    const nextSeconds = (shifted - nextMinutes * 60).toFixed(2).padStart(5, '0');
    return `[${String(nextMinutes).padStart(2, '0')}:${nextSeconds}]`;
  },
);
