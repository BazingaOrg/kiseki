import {spawn} from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import {PREVIEW_WIDTH, sourceIdentity} from './image-identity.mjs';
import {envWithoutSecrets} from './ai/caption-runtime.mjs';
import {sourceRuntimeLayout} from './runtime-layout.mjs';
import {createProcessCompletion} from './web-api/process-lifecycle.mjs';

export const AI_PREVIEW_CONCURRENCY = 2;
export const AI_PREVIEW_TIMEOUT_MS = 30_000;

const withSlot = (() => {
  let active = 0;
  const waiters = [];
  return (job) => {
    if (active >= AI_PREVIEW_CONCURRENCY) {
      return new Promise((resolve) => waiters.push(resolve)).then(() => withSlot(job));
    }
    active += 1;
    return job().finally(() => {
      active -= 1;
      const next = waiters.shift();
      if (next) next();
    });
  };
})();

const ffmpegArgs = (source, destination, width) => [
  '-y', '-v', 'error', '-i', `file:${source}`,
  '-vf', `scale='min(${width},iw)':-1`, '-frames:v', '1', '-q:v', '4', destination,
];

export const readJpegSize = (buffer) => {
  if (!buffer || buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) return null;
    const marker = buffer[offset + 1];
    if (marker === 0xd9 || marker === 0xda) return null;
    if (marker >= 0xc0 && marker <= 0xc3) {
      return {
        height: buffer.readUInt16BE(offset + 5),
        width: buffer.readUInt16BE(offset + 7),
      };
    }
    const size = buffer.readUInt16BE(offset + 2);
    if (size < 2) return null;
    offset += 2 + size;
  }
  return null;
};

export const encodeJpegStrict = (
  source,
  destination,
  width = PREVIEW_WIDTH,
  {spawn: spawnImpl = spawn, timeoutMs = AI_PREVIEW_TIMEOUT_MS, runtime = sourceRuntimeLayout, signal, lifecycle, platform} = {},
) =>
  withSlot(() => new Promise((resolve) => {
    if (signal?.aborted) { resolve(false); return; }
    const child = spawnImpl(runtime.ffmpeg, ffmpegArgs(source, destination, width), {
      stdio: 'ignore',
      detached: true,
      env: envWithoutSecrets(),
      ...(process.platform === 'win32' ? {windowsHide: true} : {}),
    });
    let settled = false;
    const completion = createProcessCompletion({
      pid: child.pid,
      platform,
      lifecycle,
      settle: () => done(false),
    });
    const timer = setTimeout(() => completion.requestTermination(), timeoutMs);
    const done = (ok) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      resolve(ok);
    };
    const abort = () => completion.requestTermination();
    signal?.addEventListener('abort', abort, {once: true});
    if (signal?.aborted) abort();
    child.on('error', () => {
      if (!child.pid) done(false);
    });
    child.on('close', (code) => {
      if (!completion.close()) done(code === 0 && fs.existsSync(destination));
    });
  }));

export const materializeAiPreview = async (sourcePath, identityKey, {
  cacheDir,
  runtime = sourceRuntimeLayout,
  signal,
  encode = encodeJpegStrict,
  readFileSync = fs.readFileSync,
  mkdirSync = fs.mkdirSync,
  rmSync = fs.rmSync,
} = {}) => {
  const dir = cacheDir ?? path.join(runtime.cacheRoot, 'ai-previews');
  mkdirSync(dir, {recursive: true, mode: 0o700});
  const key = crypto.createHash('sha1').update(identityKey).digest('hex');
  const destination = path.join(dir, `${key}.jpg`);
  const pending = `${destination}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp.jpg`;
  const ok = await encode(sourcePath, pending, PREVIEW_WIDTH, {runtime, signal});
  if (signal?.aborted) {
    try { rmSync(pending, {force: true}); } catch {}
    throw Object.assign(new Error('cancelled'), {code: 'cancelled', failureStage: 'photo-caption'});
  }
  if (!ok || !fs.existsSync(pending)) {
    try { rmSync(pending, {force: true}); } catch {}
    throw new Error('preview-encode-failed');
  }
  const buffer = readFileSync(pending);
  const size = readJpegSize(buffer);
  if (!size || size.width > PREVIEW_WIDTH) {
    try { rmSync(pending, {force: true}); } catch {}
    throw new Error('preview-invalid-jpeg');
  }
  try { fs.renameSync(pending, destination); } catch {
    try { rmSync(pending, {force: true}); } catch {}
    throw new Error('preview-encode-failed');
  }
  return {
    path: destination,
    buffer,
    sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
    width: size.width,
    height: size.height,
  };
};

export {sourceIdentity};
