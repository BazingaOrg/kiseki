import {DOMParser} from '@xmldom/xmldom';

const MAX_TTML_BYTES = 1024 * 1024;
const MAX_XML_DEPTH = 64;
const TRANSLATION_TAG = '[kiseki:translation:zh-CN]';
const localName = (node) => String(node?.localName ?? node?.nodeName ?? '').split(':').at(-1).toLowerCase();
const attr = (node, name) => node?.getAttribute?.(name) ?? '';
const role = (node) => attr(node, 'ttm:role') || attr(node, 'role');
const isChinese = (lang) => /^zh(?:-|$)/i.test(String(lang ?? ''));
const normalizeText = (text) => String(text ?? '').replace(/\s+/g, ' ').trim();
const safeLrcText = (value, label) => {
  const text = normalizeText(value);
  if (/[\r\n\[\]]/.test(text)) throw new Error(`AMLL ${label} 含不能写入 LRC 的字符`);
  return text;
};

const parseTime = (value) => {
  const raw = String(value ?? '').trim();
  if (/^\d+(?:\.\d+)?$/.test(raw)) return Number(raw);
  if (/^\d+(?:\.\d+)?s$/.test(raw)) return Number(raw.slice(0, -1));
  const parts = raw.split(':');
  if (parts.length === 2 && /^\d+$/.test(parts[0]) && /^\d+(?:\.\d+)?$/.test(parts[1])) return Number(parts[0]) * 60 + Number(parts[1]);
  if (parts.length === 3 && parts.every((part) => /^\d+(?:\.\d+)?$/.test(part))) return Number(parts[0]) * 3600 + Number(parts[1]) * 60 + Number(parts[2]);
  throw new Error(`无效 TTML 时间戳: ${raw || '(缺失)'}`);
};

const lrcTime = (seconds) => {
  const milliseconds = Math.round(seconds * 1000);
  const minutes = Math.floor(milliseconds / 60000);
  const remainder = milliseconds - minutes * 60000;
  return `${String(minutes).padStart(2, '0')}:${String(Math.floor(remainder / 1000)).padStart(2, '0')}.${String(remainder % 1000).padStart(3, '0')}`;
};

const lyricText = (node, depth = 0) => {
  if (depth > MAX_XML_DEPTH) throw new Error('AMLL TTML 嵌套过深');
  let text = '';
  for (const child of Array.from(node.childNodes ?? [])) {
    if (child.nodeType === 3 || child.nodeType === 4) text += child.data;
    else if (child.nodeType === 1 && !['x-translation', 'x-roman', 'x-bg'].includes(role(child))) text += lyricText(child, depth + 1);
  }
  return depth === 0 ? normalizeText(text) : text;
};

const auxiliaryText = (node, depth = 0) => {
  if (depth > MAX_XML_DEPTH) throw new Error('AMLL TTML 嵌套过深');
  let text = '';
  for (const child of Array.from(node.childNodes ?? [])) {
    if (child.nodeType === 3 || child.nodeType === 4) text += child.data;
    else if (child.nodeType === 1 && role(child) !== 'x-bg') text += auxiliaryText(child, depth + 1);
  }
  return depth === 0 ? normalizeText(text) : text;
};

const elements = (node, name) => {
  const found = [];
  const visit = (current, depth = 0) => {
    if (depth > MAX_XML_DEPTH) throw new Error('AMLL TTML 嵌套过深');
    for (const child of Array.from(current?.childNodes ?? [])) {
      if (child.nodeType !== 1) continue;
      if (localName(child) === name) found.push(child);
      visit(child, depth + 1);
    }
  };
  visit(node);
  return found;
};

const oneChineseTranslation = (values, label) => {
  const translated = [...new Set(values.filter((value) => value.lang && isChinese(value.lang)).map((value) => value.text).filter(Boolean))];
  if (translated.length > 1) throw new Error(`${label} 有多个中文译文，无法可靠选择`);
  return translated[0] ?? null;
};

const readDocument = (ttml) => {
  if (typeof ttml !== 'string' || !ttml.trim()) throw new Error('AMLL 未返回 TTML 歌词');
  if (Buffer.byteLength(ttml, 'utf8') > MAX_TTML_BYTES) throw new Error('AMLL TTML 歌词过大');
  if (/<!DOCTYPE|<!ENTITY/i.test(ttml)) throw new Error('AMLL TTML 不允许 DTD 或实体声明');
  const errors = [];
  const document = new DOMParser({errorHandler: {warning: (message) => errors.push(message), error: (message) => errors.push(message), fatalError: (message) => errors.push(message)}}).parseFromString(ttml, 'application/xml');
  if (errors.length || localName(document.documentElement) !== 'tt') throw new Error(`AMLL TTML 无效${errors[0] ? `: ${errors[0]}` : ''}`);
  return document;
};

export const normalizeAmllCandidate = (item) => {
  const source = item?.data ?? item ?? {};
  const metadata = source.metadata ?? {};
  const first = (value) => Array.isArray(value) ? value.find((part) => typeof part === 'string' && part.trim()) ?? '' : value ?? '';
  return {
    id: String(source.id ?? item?.id ?? ''),
    provider: 'amll',
    trackName: first(source.musicNames ?? source.musicName ?? source.name ?? metadata.musicName),
    artistName: first(source.artistNames ?? source.artists ?? source.artistName ?? source.artist ?? metadata.artists),
    albumName: first(source.albumNames ?? source.albumName ?? source.album ?? metadata.album),
    duration: null,
  };
};

export const parseAmllLyrics = (record) => {
  const source = record?.data ?? record ?? {};
  if (source.format && String(source.format).toLowerCase() !== 'ttml') throw new Error('AMLL 返回的歌词不是 TTML');
  const document = readDocument(source.lyrics ?? source.ttml);
  const headerTranslations = new Map();
  for (const translation of elements(document, 'translation')) {
    const lang = attr(translation, 'xml:lang') || attr(translation, 'lang');
    if (!isChinese(lang)) continue;
    for (const text of elements(translation, 'text')) {
      const key = attr(text, 'for');
      const value = safeLrcText(auxiliaryText(text), '中文译文');
      if (!key || !value) continue;
      const list = headerTranslations.get(key) ?? [];
      list.push({lang, text: value});
      headerTranslations.set(key, list);
    }
  }
  const rows = [];
  for (const paragraph of elements(document, 'p')) {
    const start = parseTime(attr(paragraph, 'begin'));
    const end = parseTime(attr(paragraph, 'end'));
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) throw new Error('AMLL TTML 含无效时间轴');
    const original = safeLrcText(lyricText(paragraph), '原文歌词');
    const key = attr(paragraph, 'itunes:key') || attr(paragraph, 'key');
    const inline = elements(paragraph, 'span').filter((span) => role(span) === 'x-translation').map((span) => ({lang: attr(span, 'xml:lang') || attr(span, 'lang'), text: safeLrcText(auxiliaryText(span), '中文译文')}));
    const translation = oneChineseTranslation([...inline, ...(headerTranslations.get(key) ?? [])], `AMLL 第 ${rows.length + 1} 行`);
    rows.push({start: Math.round(start * 1000) / 1000, end: Math.round(end * 1000) / 1000, original, translation});
  }
  if (!rows.length) throw new Error('AMLL TTML 没有歌词行');
  rows.sort((a, b) => a.start - b.start);
  let truncatedOverlaps = false;
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const next = rows[index + 1];
    if (next && next.start === row.start) throw new Error(`AMLL TTML 在 ${lrcTime(next.start)} 有重复时间轴`);
    if (next && next.start < row.end) {
      row.end = next.start;
      truncatedOverlaps = true;
    }
  }
  const candidate = normalizeAmllCandidate(source);
  const metadata = [];
  if (candidate.trackName) metadata.push(`[ti:${safeLrcText(candidate.trackName, '标题')}]`);
  if (candidate.artistName) metadata.push(`[ar:${safeLrcText(candidate.artistName, '歌手')}]`);
  if (candidate.albumName) metadata.push(`[al:${safeLrcText(candidate.albumName, '专辑')}]`);
  metadata.push('[kiseki:source:amll]');
  if (candidate.id) metadata.push(`[kiseki:id:${safeLrcText(candidate.id, '来源 ID')}]`);
  const author = (Array.isArray(source.authorUsernames) ? source.authorUsernames.find(Boolean) : source.authorUsernames)
    ?? (Array.isArray(source.authorIds) ? source.authorIds.find(Boolean) : source.authorIds)
    ?? elements(document, 'meta').find((meta) => ['ttmlAuthorGithubLogin', 'ttmlAuthorGithub'].includes(attr(meta, 'key')))?.getAttribute('value');
  if (author) metadata.push(`[kiseki:author:${safeLrcText(author, '作者')}]`);
  const lines = [...metadata];
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const stamp = `[${lrcTime(row.start)}]`;
    lines.push(`${stamp}${row.original}`);
    if (row.translation) lines.push(`${stamp}${TRANSLATION_TAG}${row.translation}`);
    const next = rows[index + 1];
    if (!next || row.end < next.start) lines.push(`[${lrcTime(row.end)}]`);
  }
  const warnings = [];
  if (rows.some((row) => !row.translation)) warnings.push('部分歌词没有中文译文');
  if (truncatedOverlaps) warnings.push('部分重叠歌词已在下一句开始时清屏');
  return {syncedLyrics: `${lines.join('\n')}\n`, translationCount: rows.filter((row) => row.translation).length, lineCount: rows.filter((row) => row.original).length, warnings};
};
