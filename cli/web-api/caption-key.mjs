import fs from 'node:fs';
import path from 'node:path';

import {envFilePath} from '../load-env.mjs';

const KEY = 'DEEPSEEK_API_KEY';

export const normalizeCaptionKey = (value) => {
  const key = typeof value === 'string' ? value.trim() : '';
  if (!key) {
    const error = new Error('请填写密钥。');
    error.status = 400;
    throw error;
  }
  if (/[\r\n\0]/.test(key) || key.length > 300) {
    const error = new Error('密钥格式不正确。');
    error.status = 400;
    throw error;
  }
  return key;
};

const readText = (envPath, readFileSync) => {
  try {
    return readFileSync(envPath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return '';
    throw error;
  }
};

const replaceKeyLine = (text, key) => {
  const line = `${KEY}=${JSON.stringify(key)}`;
  const lines = text.split(/\r?\n/).filter((raw) => {
    const body = raw.trim().startsWith('export ') ? raw.trim().slice(7).trim() : raw.trim();
    return !body.startsWith(`${KEY}=`);
  });
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  lines.push(line);
  return `${lines.join('\n')}\n`;
};

export const saveCaptionKey = ({
  key,
  env = process.env,
  envPath = envFilePath(env),
  readFileSync = fs.readFileSync,
  writeFileSync = fs.writeFileSync,
  mkdirSync = fs.mkdirSync,
} = {}) => {
  const normalized = normalizeCaptionKey(key);
  const next = replaceKeyLine(readText(envPath, readFileSync), normalized);
  mkdirSync(path.dirname(envPath), {recursive: true});
  const temporary = `${envPath}.${process.pid}.tmp`;
  writeFileSync(temporary, next, {mode: 0o600});
  fs.renameSync(temporary, envPath);
  env[KEY] = normalized;
  return {configured: true};
};

export const captionKeyConfigured = (env = process.env) => Boolean(String(env[KEY] ?? '').trim());
