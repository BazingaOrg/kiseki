export const PREVIEW_LINES = 12;

/** 解析 LRC 文本为 [{time, text}](秒),忽略元数据行;用于落盘前 preview。 */
/**
 * @param {string} text
 * @param {{keepGaps?: boolean}} [options]
 *   `keepGaps` 保留只有时间戳、没有文本的行。这类行在 LRC 里是"上一句到此为止"
 *   的标记(间奏、留白),对**视频字幕**没有意义(空字幕不该显示,所以默认丢掉),
 *   但对**跟播**是必需的 —— 没有它,间奏那十几秒里上一句会一直挂着高亮不消失。
 */
export const parseLrc = (text, {keepGaps = false} = {}) => {
  const entries = [];
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const tags = [...raw.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
    if (tags.length === 0) continue;
    const content = raw.replace(/\[[^\]]*\]/g, '').trim();
    if (!content && !keepGaps) continue;
    for (const tag of tags) {
      entries.push({time: Number(tag[1]) * 60 + Number(tag[2]), text: content});
    }
  }
  return entries.sort((a, b) => a.time - b.time);
};

export const formatLrcPreview = (entries, {offset = 0, limit = PREVIEW_LINES} = {}) => {
  const lines = entries.slice(offset, offset + limit).map((e) => {
    const minutes = Math.floor(e.time / 60);
    const seconds = (e.time - minutes * 60).toFixed(1).padStart(4, '0');
    return `[${String(minutes).padStart(2, '0')}:${seconds}] ${e.text}`;
  });
  return lines;
};

export const formatLrcPageTitle = (total, offset, limit = PREVIEW_LINES) =>
  `歌词预览 ${offset + 1}-${Math.min(offset + limit, total)}/共 ${total} 行`;

/**
 * 只用于决定是否做繁转简:日文歌词通常含假名,必须原样保留;
 * 有汉字但无假名时按中文处理,英文等其他脚本不处理。
 */
export const detectLyricsScript = (lrc) => {
  const entries = parseLrc(lrc);
  const text = entries.length > 0 ? entries.map((entry) => entry.text).join('\n') : String(lrc ?? '');
  if (/\p{Script=Hiragana}|\p{Script=Katakana}/u.test(text)) return 'ja';
  if (/\p{Script=Han}/u.test(text)) return 'zh';
  return 'other';
};

let simplifiedChineseConverterPromise = null;
const getSimplifiedChineseConverter = () => {
  simplifiedChineseConverterPromise ??= import('opencc-js/t2cn').then(({default: OpenCC}) => {
    const convertCharacters = OpenCC.Converter({from: 'tw', to: 'cn'});
    const normalizePronoun = OpenCC.CustomConverter([['妳', '你']]);
    return (text) => normalizePronoun(convertCharacters(text));
  });
  return simplifiedChineseConverterPromise;
};

/** LRCLIB 中文歌词优先简体;英文/日文及其他脚本原样返回。 */
export const preferSimplifiedChineseLrc = async (lrc) => {
  const lyrics = String(lrc ?? '');
  const script = detectLyricsScript(lyrics);
  if (script !== 'zh') return {lyrics, script, converted: false};
  const converter = await getSimplifiedChineseConverter();
  const simplified = converter(lyrics);
  return {lyrics: simplified, script, converted: simplified !== lyrics};
};
