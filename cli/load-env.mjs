import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ALLOWED_KEYS = new Set(['DEEPSEEK_API_KEY']);

export const repoEnvPath = (fromFile = fileURLToPath(import.meta.url)) =>
  path.resolve(path.dirname(fromFile), '..', '.env');

export const parseEnvFile = (text) => {
  const out = {};
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const body = line.startsWith('export ') ? line.slice(7).trim() : line;
    const eq = body.indexOf('=');
    if (eq <= 0) continue;
    const key = body.slice(0, eq).trim();
    if (!ALLOWED_KEYS.has(key)) continue;
    let value = body.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2)
      || (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
};

export const applyLocalEnv = (parsed, env = process.env) => {
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value !== 'string' || !value.trim()) continue;
    const current = env[key];
    if (typeof current === 'string' && current.trim()) continue;
    env[key] = value;
  }
  return env;
};

export const loadLocalEnv = ({
  envPath = repoEnvPath(),
  env = process.env,
  readFileSync = fs.readFileSync,
} = {}) => {
  let text;
  try {
    text = readFileSync(envPath, 'utf8');
  } catch {
    return env;
  }
  applyLocalEnv(parseEnvFile(text), env);
  return env;
};
