export interface PhotoOpenState {
  groupKey: string;
  path: string;
}

export const captionHintDraftKey = (projectPath: string, photoPath: string): string =>
  `${projectPath}\0${photoPath}`;

export const openPhotoIndex = (paths: string[], path: string): number => {
  const index = paths.indexOf(path);
  return index >= 0 ? index : 0;
};

export const resolveOpenPhoto = ({
  open,
  groupKey,
  paths,
  lastIndex,
}: {
  open: PhotoOpenState | null;
  groupKey: string | null;
  paths: string[];
  lastIndex: number;
}): PhotoOpenState | null => {
  if (!open || groupKey == null) return null;
  if (paths.includes(open.path)) return open;
  const fallback = paths[Math.min(Math.max(lastIndex, 0), paths.length - 1)];
  return fallback ? {groupKey, path: fallback} : null;
};
