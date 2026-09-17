export const PREVIEW_LINES = 12;

/** 解析 LRC 文本为 [{time, text}](秒),忽略元数据行;用于落盘前 preview. */
/**
 * @param {string} text
 * @param {{keepGaps?: boolean}} [options]
 *   `keepGaps` 保留只有时间戳、没有文本的行.这类行在 LRC 里是"上一句到此为止"
 *   的标记(间奏、留白),对**视频字幕**没有意义(空字幕不该显示,所以默认丢掉),
 *   但对**跟播**是必需的 —— 没有它,间奏那十几秒里上一句会一直挂着高亮不消失.
 */
export const parseLrc = (text, {keepGaps = false} = {}) => {
  const entries = [];
  const translations = new Map();
  const source = String(text ?? '');
  const extended = /\[kiseki:translation:zh-CN\]/i.test(source);
  const offsetMatch = source.match(/^\s*\[offset:([+-]?\d+)\]\s*$/im);
  const offset = extended && offsetMatch ? Number(offsetMatch[1]) / 1000 : 0;
  const originals = new Map();
  const toTime = (tag) => {
    const seconds = Number(tag[2]);
    if (extended && seconds >= 60) throw new Error('双语 LRC 含无效时间戳');
    return Math.max(0, Number(tag[1]) * 60 + seconds + offset);
  };
  for (const raw of source.split(/\r?\n/)) {
    const tags = [...raw.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
    if (tags.length === 0) continue;
    const translation = /\[kiseki:translation:zh-CN\]/i.test(raw);
    const content = raw.replace(/\[[^\]]*\]/g, '').trim();
    if (translation) {
      if (extended && !content) throw new Error('双语 LRC 中文译文为空');
      if (!content) continue;
      for (const tag of tags) {
        const time = toTime(tag);
        const existing = translations.get(time);
        if (extended && existing && existing !== content) throw new Error('双语 LRC 同一时间戳有不同中文译文');
        translations.set(time, content);
      }
      continue;
    }
    if (!content && !keepGaps) continue;
    for (const tag of tags) {
      const time = toTime(tag);
      if (extended) {
        const existing = originals.get(time);
        if (existing && existing !== content) throw new Error('双语 LRC 同一时间戳有不同原文');
        originals.set(time, content);
      }
      entries.push({time, text: content});
    }
  }
  if (extended) {
    for (const time of translations.keys()) {
      if (!originals.has(time)) throw new Error('双语 LRC 中文译文没有对应原文');
      if (!originals.get(time)) throw new Error('双语 LRC 中文译文不能对应空白时间边界');
    }
  }
  const counts = new Map();
  for (const entry of entries) counts.set(entry.time, (counts.get(entry.time) ?? 0) + 1);
  return entries.sort((a, b) => a.time - b.time).map((entry) => {
    const translation = translations.get(entry.time);
    return translation && counts.get(entry.time) === 1
      ? {...entry, translation: {text: translation, lang: 'zh'}}
      : entry;
  });
};

export const formatLrcPreview = (entries, {offset = 0, limit = PREVIEW_LINES} = {}) => {
  const lines = entries.slice(offset, offset + limit).flatMap((e) => {
    const minutes = Math.floor(e.time / 60);
    const seconds = (e.time - minutes * 60).toFixed(1).padStart(4, '0');
    const original = `[${String(minutes).padStart(2, '0')}:${seconds}] ${e.text}`;
    return e.translation ? [original, `       ${e.translation.text}`] : [original];
  });
  return lines;
};

export const formatLrcPageTitle = (total, offset, limit = PREVIEW_LINES) =>
  `歌词预览 ${offset + 1}-${Math.min(offset + limit, total)}/共 ${total} 行`;

/**
 * 只用于决定是否做繁转简:日文歌词通常含假名,必须原样保留;
 * 有汉字但无假名时按中文处理,英文等其他脚本不处理.
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

/** LRCLIB 中文歌词优先简体;英文/日文及其他脚本原样返回. */
export const preferSimplifiedChineseLrc = async (lrc) => {
  const lyrics = String(lrc ?? '');
  const script = detectLyricsScript(lyrics);
  const hasChineseTranslation = /\[kiseki:translation:zh-CN\]/i.test(lyrics);
  if (script !== 'zh' && !hasChineseTranslation) return {lyrics, script, converted: false};
  const converter = await getSimplifiedChineseConverter();
  const simplified = script === 'zh'
    ? converter(lyrics)
    : lyrics.replace(/(\[kiseki:translation:zh-CN\])([^\r\n]*)/gi, (_, tag, body) => `${tag}${converter(body)}`);
  return {lyrics: simplified, script, converted: simplified !== lyrics};
};
