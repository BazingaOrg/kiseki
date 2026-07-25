/**
 * 路径沙箱:所有 web API 的唯一入口,校验请求路径不能逃出允许的根目录。
 * 双重防护:1) path.resolve 展平 `..` 后做前缀比对;2) fs.realpathSync 解开
 * 符号链接后再比对一次,防止根目录内的软链接指向根目录外的文件。
 * 任一阶段失败都返回 null,调用方一律回 403,不泄露失败原因细节。
 */
import fs from 'node:fs';
import path from 'node:path';

const isInside = (root, target) => target === root || target.startsWith(root + path.sep);

/**
 * @param {string} root 允许访问的根目录(应已是绝对路径)
 * @param {string} requestedPath 客户端传入的路径(可能是相对/绝对/带 `..`)
 * @returns {string|null} 校验通过时返回真实绝对路径,越界或无效返回 null
 */
export const resolveSafePath = (root, requestedPath) => {
  if (typeof requestedPath !== 'string' || requestedPath.length === 0) return null;
  // 拒绝 null 字节等注入手法
  if (requestedPath.includes('\0')) return null;
  const absoluteRoot = path.resolve(root);
  const resolved = path.resolve(absoluteRoot, requestedPath);
  // 第一层:纯字符串层面的前缀校验,拦截 `..` 穿越与绝对路径逃逸,
  // 不要求路径存在——不存在的路径交给调用方 stat 后返回 404。
  if (!isInside(absoluteRoot, resolved)) return null;

  // 第二层:路径若确实存在,再展开符号链接校验一次,拦截根目录内的
  // 软链接指向根目录外的文件/目录这一逃逸手法。不存在时直接放行第一层结果。
  if (!fs.existsSync(resolved)) return resolved;
  let real;
  let realRoot;
  try {
    real = fs.realpathSync(resolved);
    realRoot = fs.realpathSync(absoluteRoot);
  } catch {
    return null;
  }
  if (!isInside(realRoot, real)) return null;
  return real;
};
