import path from 'node:path';

const isInside = (root, target) => target === root || target.startsWith(root + path.sep);

export const normalizePhotoKey = (projectRoot, source) => {
  if (typeof projectRoot !== 'string' || projectRoot.length === 0) return null;
  if (typeof source !== 'string' || source.length === 0 || source.includes('\0')) return null;
  const root = path.resolve(projectRoot);
  const resolved = path.isAbsolute(source)
    ? path.resolve(source)
    : path.resolve(root, source);
  if (!isInside(root, resolved)) return null;
  const relative = path.relative(root, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return relative.split(path.sep).join('/').replace(/^\.\//, '');
};
