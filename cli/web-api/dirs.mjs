/**
 * GET /api/dirs?path=<abs> —— 目录浏览,只返回文件夹用于导航,顶层附带
 * 简单的"像不像 tsuzuri 素材夹"提示(是否已有 tsuzuri.toml/output/等特征)。
 */
import fs from 'node:fs';
import path from 'node:path';

import {resolveSafePath} from './sandbox.mjs';

const PROJECT_HINTS = ['tsuzuri.toml', 'tsuzuri.json', 'output'];

/**
 * @param {string} root 允许浏览的根目录
 * @param {string} requestedPath 客户端传入的目录路径
 * @returns {{status: number, body: object}}
 */
export const listDirs = (root, requestedPath) => {
  const safePath = resolveSafePath(root, requestedPath);
  if (!safePath) return {status: 403, body: {error: '路径越界或无效'}};
  let stat;
  try {
    stat = fs.statSync(safePath);
  } catch {
    return {status: 404, body: {error: '路径不存在'}};
  }
  if (!stat.isDirectory()) return {status: 400, body: {error: '不是文件夹'}};

  let entries;
  try {
    entries = fs.readdirSync(safePath, {withFileTypes: true});
  } catch {
    return {status: 500, body: {error: '无法读取目录'}};
  }
  const dirs = entries
    .filter((entry) => !entry.name.startsWith('.') && entry.isDirectory())
    .map((entry) => {
      const fullPath = path.join(safePath, entry.name);
      const hasProjectHint = PROJECT_HINTS.some((hint) => fs.existsSync(path.join(fullPath, hint)));
      return {name: entry.name, path: fullPath, isProject: hasProjectHint};
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    status: 200,
    body: {
      path: safePath,
      parent: path.dirname(safePath) === safePath ? null : path.dirname(safePath),
      dirs,
      root: path.resolve(root),
    },
  };
};
