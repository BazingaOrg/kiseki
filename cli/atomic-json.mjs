import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const partialName = (finalPath) =>
  `.kiseki-partial-${path.basename(finalPath)}-${process.pid}-${crypto.randomBytes(4).toString('hex')}.json`;

/**
 * 同目录 temp + fsync + rename。失败时保留已有正式文件，只删除本次 partial。
 * 禁止对正式路径 writeFileSync。
 */
export const writeJsonAtomic = (filePath, value) => {
  const resolved = path.resolve(filePath);
  const dir = path.dirname(resolved);
  fs.mkdirSync(dir, {recursive: true});
  const pending = path.join(dir, partialName(resolved));
  let handle;
  try {
    handle = fs.openSync(pending, 'w');
    fs.writeFileSync(handle, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    fs.fsyncSync(handle);
    fs.closeSync(handle);
    handle = null;
    fs.renameSync(pending, resolved);
  } catch (error) {
    if (handle !== null && handle !== undefined) {
      try { fs.closeSync(handle); } catch {}
    }
    try { fs.rmSync(pending, {force: true}); } catch {}
    throw error;
  }
};

export const readJsonFile = (filePath) => {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
};
