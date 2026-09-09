import {
  CAPTION_MAX_TOKENS,
  CAPTION_MODEL,
  CAPTION_TIMEOUT_MS,
  DEEPSEEK_CHAT_COMPLETIONS_URL,
  SYSTEM_PROMPT,
  USER_PROMPT,
  normalizeCaption,
  repairUserPrompt,
  validateCaption,
} from './photo-caption-prompt.mjs';

export class CaptionHttpError extends Error {
  constructor(code, status, retryable, batchFatal) {
    super(code);
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    this.batchFatal = batchFatal;
  }
}

const classifyStatus = (status) => {
  if (status === 401 || status === 403) return new CaptionHttpError('auth', status, false, true);
  if (status === 429 || status >= 500) return new CaptionHttpError('http', status, true, false);
  if (status >= 400) return new CaptionHttpError('request', status, false, true);
  return null;
};

export const buildCaptionRequestBody = ({jpegBase64, repairReason = null}) => ({
  model: CAPTION_MODEL,
  messages: [
    {role: 'system', content: SYSTEM_PROMPT},
    {
      role: 'user',
      content: [
        {type: 'text', text: repairReason ? repairUserPrompt(repairReason) : USER_PROMPT},
        {type: 'image_url', image_url: {url: `data:image/jpeg;base64,${jpegBase64}`, detail: 'low'}},
      ],
    },
  ],
  thinking: {type: 'disabled'},
  max_tokens: CAPTION_MAX_TOKENS,
  stream: false,
});

const parseUsage = (payload) => ({
  input_tokens: Number(payload?.usage?.prompt_tokens) || 0,
  output_tokens: Number(payload?.usage?.completion_tokens) || 0,
});

const parseContent = (payload) => {
  const choice = payload?.choices?.[0];
  const content = choice?.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((part) => (typeof part?.text === 'string' ? part.text : '')).join('');
  }
  return '';
};

export const requestCaption = async ({
  jpegBuffer,
  apiKey,
  signal,
  repairReason = null,
  fetchImpl = fetch,
  timeoutMs = CAPTION_TIMEOUT_MS,
  now = Date.now,
}) => {
  const jpegBase64 = Buffer.from(jpegBuffer).toString('base64');
  const body = buildCaptionRequestBody({jpegBase64, repairReason});
  if (body.messages[0].role !== 'system' || typeof body.messages[0].content !== 'string') {
    throw new CaptionHttpError('request-shape', 0, false, true);
  }
  if (body.messages[1].role !== 'user' || !Array.isArray(body.messages[1].content)) {
    throw new CaptionHttpError('request-shape', 0, false, true);
  }
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort, {once: true});
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = now();
  try {
    const response = await fetchImpl(DEEPSEEK_CHAT_COMPLETIONS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const classified = classifyStatus(response.status);
    if (classified) throw classified;
    const payload = await response.json();
    const validation = validateCaption(parseContent(payload));
    return {
      validation,
      usage: parseUsage(payload),
      durationMs: Math.max(0, now() - started),
      text: validation.ok ? validation.text : normalizeCaption(parseContent(payload)),
    };
  } catch (error) {
    if (error instanceof CaptionHttpError) throw error;
    if (error?.name === 'AbortError') {
      if (signal?.aborted) throw new CaptionHttpError('cancelled', 0, false, false);
      throw new CaptionHttpError('timeout', 0, true, false);
    }
    throw new CaptionHttpError('network', 0, true, false);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
};
