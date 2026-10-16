import {spawn} from 'node:child_process';
import {envWithoutSecrets} from './secret-env.mjs';

const FRAME_BYTES = 64 * 64;

const isSingleFrameDiscontinuity = (before, current, after, jumpThreshold, returnThreshold) => {
  const firstJump = meanPixelDifference(before, current);
  if (firstJump <= jumpThreshold) return false;
  const secondJump = meanPixelDifference(current, after);
  return secondJump > jumpThreshold &&
    meanPixelDifference(before, after) < Math.max(returnThreshold, Math.min(firstJump, secondJump) / 4);
};

export const meanPixelDifference = (left, right) => {
  let total = 0;
  for (let index = 0; index < FRAME_BYTES; index += 1) {
    total += Math.abs(left[index] - right[index]);
  }
  return total / FRAME_BYTES;
};

export const findSingleFrameDiscontinuities = (frames, {jumpThreshold = 8, returnThreshold = 1} = {}) => {
  const found = [];
  for (let index = 1; index < frames.length - 1; index += 1) {
    if (isSingleFrameDiscontinuity(frames[index - 1], frames[index], frames[index + 1], jumpThreshold, returnThreshold)) {
      found.push(index);
    }
  }
  return found;
};

export const scanSingleFrameDiscontinuities = async (videoPath, ffmpegPath) => {
  const child = spawn(ffmpegPath, [
    '-hide_banner', '-loglevel', 'error', '-i', videoPath,
    '-map', '0:v:0', '-vf', 'scale=64:64,format=gray',
    '-fps_mode', 'passthrough', '-f', 'rawvideo', '-',
  ], {env: envWithoutSecrets(), stdio: ['ignore', 'pipe', 'pipe']});
  const exit = new Promise((resolve) => {
    child.once('error', (error) => resolve({error}));
    child.once('close', (code) => resolve({code}));
  });
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-4000); });

  const found = [];
  let previousPrevious = null;
  let previous = null;
  let pending = Buffer.alloc(0);
  let frameCount = 0;
  try {
    for await (const chunk of child.stdout) {
      pending = Buffer.concat([pending, chunk]);
      while (pending.length >= FRAME_BYTES) {
        const frame = pending.subarray(0, FRAME_BYTES);
        pending = pending.subarray(FRAME_BYTES);
        if (previousPrevious && previous && isSingleFrameDiscontinuity(previousPrevious, previous, frame, 8, 1)) {
          found.push(frameCount - 1);
        }
        previousPrevious = previous;
        previous = frame;
        frameCount += 1;
      }
    }
  } catch (error) {
    child.kill();
    throw error;
  }
  const result = await exit;
  if (result.error) throw result.error;
  if (result.code !== 0 || pending.length !== 0) {
    throw new Error(`成片逐帧检查失败: ${stderr.trim() || `ffmpeg 退出码 ${result.code}`}`);
  }
  return {frameCount, found};
};
