import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const SOURCE_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const RUNTIME_LAYOUT_ENV = 'KISEKI_RUNTIME_LAYOUT';

const normalizePath = (value, name) => {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`RuntimeLayout.${name} 必须是非空路径`);
  }
  return path.resolve(value);
};

const normalizeCommand = (value, name) => {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`RuntimeLayout.${name} 必须是非空命令或路径`);
  }
  return value.includes(path.sep) || path.isAbsolute(value) ? path.resolve(value) : value;
};

const readRuntimeOverrides = (env = process.env) => {
  const raw = env[RUNTIME_LAYOUT_ENV];
  if (raw === undefined) return {};
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError();
    return value;
  } catch (error) {
    throw new TypeError(`${RUNTIME_LAYOUT_ENV} 必须是有效的 RuntimeLayout JSON`, {cause: error});
  }
};

export const createRuntimeLayout = (overrides = {}) => {
  const sourceRoot = normalizePath(overrides.sourceRoot ?? SOURCE_ROOT, 'sourceRoot');
  const cacheRoot = normalizePath(
    overrides.cacheRoot ?? path.join(os.tmpdir(), `kiseki-${process.getuid?.() ?? 'user'}`),
    'cacheRoot',
  );
  const thumbCacheRoot = overrides.thumbCacheRoot ?? (
    overrides.cacheRoot === undefined
      ? path.join(os.tmpdir(), `kiseki-thumbs-${process.getuid?.() ?? 'user'}`)
      : path.join(cacheRoot, 'thumbs')
  );
  const layout = {
    cliEntry: overrides.cliEntry ?? path.join(sourceRoot, 'cli', 'kiseki.mjs'),
    webDist: overrides.webDist ?? path.join(sourceRoot, 'web', 'dist'),
    analyzerRoot: overrides.analyzerRoot ?? path.join(sourceRoot, 'analyzer'),
    rendererRoot: overrides.rendererRoot ?? path.join(sourceRoot, 'renderer'),
    ffmpeg: overrides.ffmpeg ?? 'ffmpeg',
    ffprobe: overrides.ffprobe ?? 'ffprobe',
    ytDlp: overrides.ytDlp ?? 'yt-dlp',
    curl: overrides.curl ?? 'curl',
    uv: overrides.uv ?? 'uv',
    cacheRoot,
    thumbCacheRoot,
    modelRoot: overrides.modelRoot ?? path.join(cacheRoot, 'models'),
    tempRoot: overrides.tempRoot ?? os.tmpdir(),
    analyzerEnvRoot: overrides.analyzerEnvRoot ?? path.join(cacheRoot, 'analyzer-env'),
    wheelhouseRoot: overrides.wheelhouseRoot ?? path.join(sourceRoot, 'analyzer', 'wheelhouse'),
    chromium: overrides.chromium ?? 'chrome-headless-shell',
    analyzerOffline: overrides.analyzerOffline ?? false,
    python: overrides.python ?? 'python3',
  };
  return Object.freeze({
    cliEntry: normalizePath(layout.cliEntry, 'cliEntry'),
    webDist: normalizePath(layout.webDist, 'webDist'),
    analyzerRoot: normalizePath(layout.analyzerRoot, 'analyzerRoot'),
    rendererRoot: normalizePath(layout.rendererRoot, 'rendererRoot'),
    ffmpeg: normalizeCommand(layout.ffmpeg, 'ffmpeg'),
    ffprobe: normalizeCommand(layout.ffprobe, 'ffprobe'),
    ytDlp: normalizeCommand(layout.ytDlp, 'ytDlp'),
    curl: normalizeCommand(layout.curl, 'curl'),
    uv: normalizeCommand(layout.uv, 'uv'),
    cacheRoot,
    thumbCacheRoot: normalizePath(layout.thumbCacheRoot, 'thumbCacheRoot'),
    modelRoot: normalizePath(layout.modelRoot, 'modelRoot'),
    tempRoot: normalizePath(layout.tempRoot, 'tempRoot'),
    analyzerEnvRoot: normalizePath(layout.analyzerEnvRoot, 'analyzerEnvRoot'),
    wheelhouseRoot: normalizePath(layout.wheelhouseRoot, 'wheelhouseRoot'),
    chromium: normalizeCommand(layout.chromium, 'chromium'),
    analyzerOffline: Boolean(layout.analyzerOffline),
    python: normalizeCommand(layout.python, 'python'),
  });
};

export const runtimeLayoutEnv = (runtime) => ({
  [RUNTIME_LAYOUT_ENV]: JSON.stringify(runtime),
});

const sourceOverrides = readRuntimeOverrides();
export const sourceRuntimeLayout = createRuntimeLayout({
  ...sourceOverrides,
  modelRoot: sourceOverrides.modelRoot ?? path.join(SOURCE_ROOT, 'models'),
});
