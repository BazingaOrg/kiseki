import path from 'node:path';

import {writeJsonAtomic, readJsonFile} from '../atomic-json.mjs';
import {identityRecordKey} from '../image-identity.mjs';
import {CAPTION_MODEL, PROMPT_VERSION, promptHash} from './photo-caption-prompt.mjs';

export const CACHE_VERSION = 1;

export const captionsPathFor = (projectRoot) =>
  path.join(projectRoot, 'output', 'metadata', 'ai-captions.json');

const emptyCache = () => ({
  version: CACHE_VERSION,
  model: CAPTION_MODEL,
  prompt_hash: promptHash,
  prompt_version: PROMPT_VERSION,
  revision: 0,
  items: {},
});

export const isUsableCache = (value) =>
  Boolean(
    value &&
    value.version === CACHE_VERSION &&
    value.model === CAPTION_MODEL &&
    value.prompt_hash === promptHash &&
    value.items &&
    typeof value.items === 'object' &&
    !Array.isArray(value.items),
  );

export const loadCaptionCache = (filePath) => {
  const parsed = readJsonFile(filePath);
  return isUsableCache(parsed) ? parsed : emptyCache();
};

export const cacheHit = (cache, key, identityRecord) => {
  if (!isUsableCache(cache)) return null;
  const item = cache.items[key];
  if (!item || typeof item.text !== 'string' || !item.text) return null;
  if (!item.source_identity || identityRecordKey(item.source_identity) !== identityRecordKey(identityRecord)) {
    return null;
  }
  if (typeof item.preview_sha256 !== 'string' || item.preview_sha256.length !== 64) return null;
  return item;
};

export const upsertCaptionItem = (cache, key, item) => {
  const next = {
    version: CACHE_VERSION,
    model: CAPTION_MODEL,
    prompt_hash: promptHash,
    prompt_version: PROMPT_VERSION,
    revision: Number(cache.revision ?? 0) + 1,
    items: {...(isUsableCache(cache) ? cache.items : {}), [key]: item},
  };
  return next;
};

export const writeCaptionCache = (filePath, cache) => {
  writeJsonAtomic(filePath, cache);
};

export const createSerialWriter = ({write = writeCaptionCache} = {}) => {
  let chain = Promise.resolve();
  let pending = 0;
  const enqueue = (filePath, cache) => {
    pending += 1;
    const run = chain.then(async () => {
      write(filePath, cache);
    }).finally(() => {
      pending -= 1;
    });
    chain = run.catch(() => {});
    return run;
  };
  return {
    enqueue,
    drain: async () => {
      await chain;
    },
    get pending() { return pending; },
  };
};
