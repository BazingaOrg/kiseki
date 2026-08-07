/**
 * Remotion bundle 共享 helper:视频 render 与 still 共用同一套打包配置.
 */

import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const RENDERER = path.join(REPO, 'renderer');
const requireRenderer = createRequire(path.join(RENDERER, 'package.json'));

/**
 * @param {string} publicDir
 * @param {{onProgress?: (value: number) => void}} [opts]
 * @returns {Promise<{serveUrl: string, bundleDir: string | null, cleanup: () => void}>}
 */
export const bundleRenderer = async (publicDir, opts = {}) => {
  const {bundle} = requireRenderer('@remotion/bundler');
  let bundleDir = null;
  const serveUrl = await bundle({
    entryPoint: path.join(RENDERER, 'src/index.ts'),
    publicDir,
    rootDir: RENDERER,
    symlinkPublicDir: true,
    onDirectoryCreated: (directory) => {
      bundleDir = directory;
    },
    onProgress: opts.onProgress,
    webpackOverride: (config) => ({
      ...config,
      module: {
        ...config.module,
        rules: [
          ...(config.module?.rules ?? []),
          {test: /\.(ttf|otf|woff2?)$/, type: 'asset/resource'},
        ],
      },
    }),
  });
  return {
    serveUrl,
    bundleDir,
    cleanup: () => {
      if (bundleDir) fs.rmSync(bundleDir, {recursive: true, force: true});
    },
  };
};

export const loadRemotionRenderer = () => requireRenderer('@remotion/renderer');
