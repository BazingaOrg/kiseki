/**
 * 逐行字体路由:按文本语种(假名/CJK/纯拉丁)在字族(衬线/黑体)内选具体字体。
 * 纯函数,与 React 无关,便于 node 直测。
 */
import {FONT_FAMILY, type FontFamily} from './theme.ts';
import type {SubtitleLine} from './types.ts';

const KANA_RE = /[぀-ヿ]/; // ひらがな + カタカナ
const CJK_RE = /[㐀-䶿一-鿿豈-﫿]/;
const LATIN_ONLY_RE = /^[ -ɏ -⁯]*$/;
const FULLWIDTH_RE = /[　-〿＀-￯]/;

/** 全角等效字符数:CJK/假名/全角符号计 1,其余计 0.5 */
export const fullwidthLength = (text: string): number => {
  let n = 0;
  for (const ch of text) {
    n += KANA_RE.test(ch) || CJK_RE.test(ch) || FULLWIDTH_RE.test(ch) ? 1 : 0.5;
  }
  return n;
};

/**
 * 含假名 → JP;纯 CJK 无假名 → SC(Whisper 标 ja 时用 JP 双重校验);
 * 纯拉丁 → Noto Sans/Serif;混合行走 font stack 自然回退。
 * family 由模板声明(见 templates.ts 的 fontFamily),缺省衬线。
 */
export const resolveFontFamily = (text: string, lang: SubtitleLine['lang'], family: FontFamily = 'serif'): string => {
  const fonts = FONT_FAMILY[family];
  if (KANA_RE.test(text)) return fonts.ja;
  if (CJK_RE.test(text)) return lang === 'ja' ? fonts.ja : fonts.zh;
  if (LATIN_ONLY_RE.test(text)) return fonts.en;
  return fonts[lang] ?? fonts.mixed;
};
