import path from 'node:path';

import {runtimeLayoutEnv, sourceRuntimeLayout} from './runtime-layout.mjs';

const TOOL_FIELDS = Object.freeze({
  ffmpeg: 'ffmpeg',
  ffprobe: 'ffprobe',
  ytDlp: 'yt-dlp',
  curl: 'curl',
  uv: 'uv',
});

const OMIT_KEY_DEFAULTS = Object.freeze(['DEEPSEEK_API_KEY']);

const withoutKeys = (env, keys) => {
  if (!keys || keys.length === 0) return env;
  const next = {...env};
  for (const key of keys) delete next[key];
  return next;
};

const createResolver = ({runtime, executable, baseEnv, electron}) => {
  const command = (target, args, {env = {}, stdio = 'inherit', displayName, runAsNode = false, omitEnvKeys = []} = {}) => Object.freeze({
    executable: target,
    args: Object.freeze([...args]),
    env: Object.freeze(withoutKeys({
      ...baseEnv,
      ...runtimeLayoutEnv(runtime),
      ...env,
      ...(electron && runAsNode ? {ELECTRON_RUN_AS_NODE: '1'} : {}),
    }, omitEnvKeys)),
    stdio,
    displayName,
  });
  return Object.freeze({
    runtime,
    cli: (args, options = {}) => command(executable, [runtime.cliEntry, ...args], {...options, displayName: 'kiseki', runAsNode: true}),
    renderer: (args, options = {}) => command(executable, [path.join(path.dirname(runtime.cliEntry), 'render.mjs'), ...args], {
      ...options,
      displayName: 'renderer',
      runAsNode: true,
      omitEnvKeys: options.omitEnvKeys ?? OMIT_KEY_DEFAULTS,
    }),
    analyzer: (entry, args, options = {}) => command(runtime.uv, ['run', ...(runtime.analyzerOffline ? ['--offline', '--frozen'] : []), '--project', runtime.analyzerRoot, entry, ...args], {
      ...options,
      env: {
        KISEKI_MODEL_ROOT: runtime.modelRoot,
        KISEKI_FFMPEG_BIN: runtime.ffmpeg,
        ...(runtime.analyzerOffline ? {UV_PROJECT_ENVIRONMENT: runtime.analyzerEnvRoot, UV_FIND_LINKS: runtime.wheelhouseRoot, UV_NO_INDEX: '1', UV_PYTHON: runtime.python, UV_PYTHON_DOWNLOADS: 'never'} : {}),
        ...options.env,
      },
      displayName: 'uv',
      omitEnvKeys: options.omitEnvKeys ?? OMIT_KEY_DEFAULTS,
    }),
    tool: (name, args, options = {}) => {
      if (!Object.hasOwn(TOOL_FIELDS, name)) throw new TypeError(`未知 RuntimeLayout 工具: ${name}`);
      return command(runtime[name], args, {
        ...options,
        displayName: TOOL_FIELDS[name],
        omitEnvKeys: options.omitEnvKeys ?? OMIT_KEY_DEFAULTS,
      });
    },
  });
};

export const createNodeCommandResolver = ({runtime = sourceRuntimeLayout, executable = process.execPath, baseEnv = process.env} = {}) =>
  createResolver({runtime, executable, baseEnv, electron: false});

export const createElectronCommandResolver = ({runtime = sourceRuntimeLayout, executable, baseEnv = process.env} = {}) => {
  if (typeof executable !== 'string' || executable.length === 0) throw new TypeError('Electron executable 必须是非空路径');
  return createResolver({runtime, executable, baseEnv, electron: true});
};
