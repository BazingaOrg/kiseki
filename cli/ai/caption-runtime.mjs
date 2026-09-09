import {defaultJsonWrite, jsonProgressEnabled} from '../term.mjs';

const SECRET_ENV_KEYS = ['DEEPSEEK_API_KEY'];

export const envWithoutSecrets = (env = process.env) => {
  const next = {...env};
  for (const key of SECRET_ENV_KEYS) delete next[key];
  return next;
};

export const withProcessAbort = async (fn, {signals = ['SIGTERM', 'SIGINT']} = {}) => {
  const controller = new AbortController();
  const abort = () => controller.abort();
  for (const name of signals) process.once(name, abort);
  try {
    return await fn(controller.signal);
  } finally {
    for (const name of signals) process.removeListener(name, abort);
  }
};

export const emitCaptionFailure = (error, jsonWrite = defaultJsonWrite) => {
  if (!jsonProgressEnabled()) return;
  jsonWrite({
    kind: 'error',
    text: error instanceof Error ? error.message : String(error),
    stage: '准备图片旁白',
    failureStage: error?.failureStage ?? 'photo-caption',
    code: error?.code ?? 'caption-failed',
  });
};
