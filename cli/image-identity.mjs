import fs from 'node:fs';

export const PREVIEW_WIDTH = 640;

export const statPart = (stat, nsName, msName) => {
  if (stat[nsName] !== undefined) return String(stat[nsName]);
  return String(stat[msName] ?? '');
};

export const identityFields = (relativePath, stat, width = PREVIEW_WIDTH) => [
  relativePath,
  String(stat.dev ?? ''),
  String(stat.ino ?? ''),
  String(stat.size ?? ''),
  statPart(stat, 'mtimeNs', 'mtimeMs'),
  statPart(stat, 'ctimeNs', 'ctimeMs'),
  String(width),
];

export const sourceIdentity = (filePath, stat, width) =>
  identityFields(filePath, stat, width).join('\0');

export const captionSourceIdentity = (relativePath, stat, width = PREVIEW_WIDTH) =>
  identityFields(relativePath, stat, width).join('\0');

export const sourceIdentityRecord = (relativePath, stat, width = PREVIEW_WIDTH) => ({
  relative_path: relativePath,
  dev: String(stat.dev ?? ''),
  ino: String(stat.ino ?? ''),
  size: Number(stat.size ?? 0),
  mtime_ns: statPart(stat, 'mtimeNs', 'mtimeMs'),
  ctime_ns: statPart(stat, 'ctimeNs', 'ctimeMs'),
  preview_width: width,
});

export const identityRecordKey = (record) => [
  record.relative_path,
  record.dev,
  record.ino,
  String(record.size),
  record.mtime_ns,
  record.ctime_ns,
  String(record.preview_width),
].join('\0');

export const readSourceStat = (filePath, statSync = fs.statSync) => {
  try { return statSync(filePath, {bigint: true}); } catch {
    try { return statSync(filePath); } catch { return null; }
  }
};
