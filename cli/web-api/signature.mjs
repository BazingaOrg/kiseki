import {SignatureError, renderSignatureSvg} from '../signature-svg.mjs';

export const previewSignature = (raw) => {
  let body;
  try {
    body = JSON.parse(raw || '{}');
  } catch {
    return {status: 400, body: {error: '请求体不是合法 JSON'}};
  }
  try {
    return {status: 200, body: {svg: renderSignatureSvg(body?.name)}};
  } catch (error) {
    if (error instanceof SignatureError) return {status: 400, body: {error: error.message}};
    throw error;
  }
};
