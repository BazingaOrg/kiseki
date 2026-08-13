import path from 'node:path';

export const createDesktopRuntime = ({resourcesPath, userData, cache, packaged, createRuntimeLayout}) => createRuntimeLayout(packaged ? {
  sourceRoot: path.join(resourcesPath, 'kiseki-runtime'),
  cacheRoot: cache,
  modelRoot: path.join(userData, 'models'),
  tempRoot: path.join(cache, 'tmp'),
  ffmpeg: path.join(resourcesPath, 'kiseki-runtime', 'bin', 'ffmpeg'),
  ffprobe: path.join(resourcesPath, 'kiseki-runtime', 'bin', 'ffprobe'),
  uv: path.join(resourcesPath, 'kiseki-runtime', 'bin', 'uv'),
  wheelhouseRoot: path.join(resourcesPath, 'kiseki-runtime', 'analyzer', 'wheelhouse'),
  analyzerEnvRoot: path.join(userData, 'analyzer-env'),
  chromium: path.join(resourcesPath, 'kiseki-runtime', 'chromium', 'bin', 'chrome-headless-shell'),
  python: path.join(resourcesPath, 'kiseki-runtime', 'python', 'bin', 'python3'),
  analyzerOffline: true,
} : {cacheRoot: cache, modelRoot: path.join(userData, 'models')});
