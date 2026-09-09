import {createHash} from 'node:crypto';

export const PROMPT_VERSION = 2;
export const CAPTION_MODEL = 'deepseek-v4-flash-vision-exp';
export const CAPTION_MAX_CODE_POINTS = 30;
export const CAPTION_MAX_TOKENS = 64;
export const CAPTION_TIMEOUT_MS = 45_000;
export const DEEPSEEK_CHAT_COMPLETIONS_URL = 'https://api.deepseek.com/chat/completions';

export const SYSTEM_PROMPT = `你是一位为「电子相框」撰写旁白短句的中文文案助手。
你的目标不是说明画面，而是为画面补上一点“画外之意”。

创作原则：
1. 先确认画面里实际看得见的主体、动作和空间关系，再写那一句；读者应能对上这张图。
2. 不要引入画面中没有的物件、场所、声音或事件。
3. 不要写成“图中有什么”的说明文，也不要罗列元素。
4. 只基于能确定的信息联想，不要虚构时间、人物关系或故事背景。
5. 文案应自然、有趣，带一点幽默或者诗意，但请避免煽情、鸡汤。
6. 避免使用以下词语：世界、梦、时光、岁月、温柔、治愈、刚刚好、悄悄、慢慢 等（但不是绝对禁止）。
7. 严禁使用如下句式：……里……着整个世界；……里……着整个夏天；……得像……（简单的比喻）; ……比……还……； ……得比……更……。
8. 可以偏向以下风格之一：
   - 日常中的微妙情绪
   - 轻微自嘲或冷幽默
   - 对瞬间的含蓄感受
   - 看似平淡但有余味的一句判断
9. 避免小学生作文式的、套路式的模板化表达

格式要求：
1. 只输出一句中文短句，不要换行，不要引号，不要任何解释。
2. 建议长度 8～24 个汉字，最多不超过 30 个汉字。
3. 不要出现“这张照片”“这一刻”“那天”等指代照片本身的词。`;

export const USER_PROMPT = '请看着这张照片，写一句符合规则的中文旁白。';

export const promptHash = createHash('sha256')
  .update(`v${PROMPT_VERSION}\0${SYSTEM_PROMPT}\0${USER_PROMPT}`)
  .digest('hex');

const WRAP_QUOTES = new Set(['"', "'", '“', '”', '‘', '’', '「', '」', '『', '』']);
const PHOTO_DEIXIS = ['这张照片', '这一刻', '那天'];
const FORBIDDEN_PATTERNS = [
  {id: 'world-in', re: /里.+着整个世界/},
  {id: 'summer-in', re: /里.+着整个夏天/},
  {id: 'like', re: /得像/},
  {id: 'more-than', re: /比.+还/},
  {id: 'even-more', re: /得比.+更/},
];

export const normalizeCaption = (raw) => String(raw ?? '').trim();

export const validateCaption = (raw) => {
  const text = normalizeCaption(raw);
  if (!text) return {ok: false, reason: 'empty', text};
  if (/[\n\r]/.test(text)) return {ok: false, reason: 'newline', text};
  const chars = [...text];
  if (chars.length >= 2 && WRAP_QUOTES.has(chars[0]) && WRAP_QUOTES.has(chars[chars.length - 1])) {
    return {ok: false, reason: 'quoted', text};
  }
  if (chars.length > CAPTION_MAX_CODE_POINTS) return {ok: false, reason: 'too-long', text};
  for (const phrase of PHOTO_DEIXIS) {
    if (text.includes(phrase)) return {ok: false, reason: 'photo-deixis', text};
  }
  for (const pattern of FORBIDDEN_PATTERNS) {
    if (pattern.re.test(text)) return {ok: false, reason: pattern.id, text};
  }
  return {ok: true, reason: null, text};
};

export const repairUserPrompt = (reason) =>
  `${USER_PROMPT}\n上一句不合规（${reason}），请只输出一句不超过 30 个汉字的中文短句，不要换行、引号或解释。`;
