import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CaptionHttpError,
  buildCaptionRequestBody,
  requestCaption,
} from './deepseek-vision-client.mjs';
import {SYSTEM_PROMPT, USER_PROMPT} from './photo-caption-prompt.mjs';

test('request body keeps system text-only and puts the image in the user message', () => {
  const body = buildCaptionRequestBody({jpegBase64: 'abc'});
  assert.equal(body.model, 'deepseek-v4-flash-vision-exp');
  assert.equal(body.thinking.type, 'disabled');
  assert.equal(body.max_tokens, 64);
  assert.equal(body.stream, false);
  assert.equal(body.messages[0].role, 'system');
  assert.equal(body.messages[0].content, SYSTEM_PROMPT);
  assert.equal(body.messages[1].role, 'user');
  assert.equal(body.messages[1].content[0].text, USER_PROMPT);
  assert.equal(body.messages[1].content[1].image_url.detail, 'high');
  assert.match(body.messages[1].content[1].image_url.url, /^data:image\/jpeg;base64,abc$/);
});

test('requestCaption classifies auth, retryable and success paths', async () => {
  const jpegBuffer = Buffer.from('jpeg');
  const seen = [];
  const fetchImpl = async (url, options) => {
    seen.push({url, headers: options.headers, body: JSON.parse(options.body)});
    assert.equal(options.headers.Authorization.startsWith('Bearer '), true);
    assert.equal(JSON.stringify(options.body).includes('Bearer'), false);
    return {
      status: 200,
      json: async () => ({
        choices: [{message: {content: '坐得端正，也不耽误心里走神'}}],
        usage: {prompt_tokens: 10, completion_tokens: 8},
      }),
    };
  };
  const result = await requestCaption({jpegBuffer, apiKey: 'secret-key', fetchImpl});
  assert.equal(result.validation.ok, true);
  assert.equal(result.usage.input_tokens, 10);
  assert.equal(seen[0].url, 'https://api.deepseek.com/chat/completions');
  assert.equal(typeof seen[0].body.messages[0].content, 'string');

  await assert.rejects(
    () => requestCaption({
      jpegBuffer, apiKey: 'secret-key',
      fetchImpl: async () => ({status: 401, json: async () => ({})}),
    }),
    (error) => error instanceof CaptionHttpError && error.batchFatal && error.code === 'auth',
  );
  await assert.rejects(
    () => requestCaption({
      jpegBuffer, apiKey: 'secret-key',
      fetchImpl: async () => ({status: 429, json: async () => ({})}),
    }),
    (error) => error instanceof CaptionHttpError && error.retryable,
  );
});
