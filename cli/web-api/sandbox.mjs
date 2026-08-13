/**
 * 路径沙箱:所有 web API 的唯一入口,校验请求路径不能逃出允许的根目录.
 * 双重防护:1) path.resolve 展平 `..` 后做前缀比对;2) fs.realpathSync 解开
 * 符号链接后再比对一次,防止根目录内的软链接指向根目录外的文件.
 * 任一阶段失败都返回 null,调用方一律回 403,不泄露失败原因细节.
 */
import fs from 'node:fs';
import path from 'node:path';

const isInside = (root, target) => target === root || target.startsWith(root + path.sep);

const existingAncestor = (absolute) => {
  let current = path.resolve(absolute);
  const missing = [];
  while (current !== path.dirname(current)) {
    if (fs.existsSync(current)) {
      try {
        return path.join(fs.realpathSync(current), ...missing.reverse());
      } catch {
        return null;
      }
    }
    missing.push(path.basename(current));
    current = path.dirname(current);
  }
  return path.resolve(absolute);
};

/**
 * @param {string} root 允许访问的根目录(应已是绝对路径)
 * @param {string} requestedPath 客户端传入的路径(可能是相对/绝对/带 `..`)
 * @returns {string|null} 校验通过时返回真实绝对路径,越界或无效返回 null
 */
export const resolveSafePath = (root, requestedPath) => {
  if (typeof requestedPath !== 'string' || requestedPath.length === 0) return null;
  if (requestedPath.includes('\0')) return null;
  let realRoot;
  try {
    realRoot = fs.existsSync(root) ? fs.realpathSync(path.resolve(root)) : path.resolve(root);
  } catch {
    return null;
  }
  const resolved = existingAncestor(path.resolve(realRoot, requestedPath));
  if (resolved === null) return null;
  if (fs.existsSync(resolved)) {
    try {
      const real = fs.realpathSync(resolved);
      return isInside(realRoot, real) ? real : null;
    } catch {
      return null;
    }
  }
  return isInside(realRoot, resolved) ? resolved : null;
};
