/**
 * Remotion bundle 共享 helper:视频 render 与 still 共用同一套打包配置.
 */

import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';

import {sourceRuntimeLayout} from './runtime-layout.mjs';

export const RENDERER = sourceRuntimeLayout.rendererRoot;

export const remotionBundleCacheDir = (runtime, rendererRoot) =>
  path.join(runtime.cacheRoot, 'remotion-bundle', createHash('sha1').update(rendererRoot).digest('hex').slice(0, 16));

export const resetBundlePublicDir = (bundleDir) => {
  if (!bundleDir) return;
  fs.rmSync(path.join(bundleDir, 'public'), {recursive: true, force: true});
};

const loadBundler = (rendererRoot) => {
  const requireRenderer = createRequire(path.join(rendererRoot, 'package.json'));
  return requireRenderer('@remotion/bundler').bundle;
};

/**
 * @param {string} publicDir
 * @param {{onProgress?: (value: number) => void, runtime?: object, bundle?: Function, persist?: boolean}} [opts]
 * @returns {Promise<{serveUrl: string, bundleDir: string | null, cleanup: () => void}>}
 */
export const bundleRenderer = async (publicDir, opts = {}) => {
  const runtime = opts.runtime ?? sourceRuntimeLayout;
  const rendererRoot = runtime.rendererRoot ?? RENDERER;
  const persist = opts.persist !== false;
  const bundle = opts.bundle ?? loadBundler(rendererRoot);
  let bundleDir = persist ? remotionBundleCacheDir(runtime, rendererRoot) : null;
  if (bundleDir) resetBundlePublicDir(bundleDir);

  const serveUrl = await bundle({
    entryPoint: path.join(rendererRoot, 'src/index.ts'),
    publicDir,
    rootDir: rendererRoot,
    symlinkPublicDir: true,
    ...(bundleDir ? {outDir: bundleDir} : {}),
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
      if (!bundleDir) return;
      if (persist) resetBundlePublicDir(bundleDir);
      else fs.rmSync(bundleDir, {recursive: true, force: true});
    },
  };
};

export const loadRemotionRenderer = (runtime = sourceRuntimeLayout) =>
  createRequire(path.join(runtime.rendererRoot, 'package.json'))('@remotion/renderer');
