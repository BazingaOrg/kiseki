type SortableAsset = {
  path: string;
  mtimeMs?: number;
};

export type PhotoSortDirection = 'shot-asc' | 'shot-desc';

export const PHOTO_SORT_LABELS: Record<PhotoSortDirection, string> = {
  'shot-asc': '从早到晚',
  'shot-desc': '从晚到早',
};

export const togglePhotoSort = (sort: PhotoSortDirection): PhotoSortDirection =>
  sort === 'shot-asc' ? 'shot-desc' : 'shot-asc';

export const photoSortStorageKey = (folder: string) => `kiseki-photo-sort:${folder}`;

export const normalizePhotoSort = (value: string | null): PhotoSortDirection => {
  if (value === 'shot-asc' || value === 'shot' || value === 'filename') return 'shot-asc';
  if (value === 'shot-desc' || value === 'mtime') return 'shot-desc';
  return 'shot-asc';
};

export const readPhotoSort = (folder: string): PhotoSortDirection => {
  try {
    return normalizePhotoSort(localStorage.getItem(photoSortStorageKey(folder)));
  } catch {}
  return 'shot-asc';
};

export const shotTimeKey = (datetime: string | null | undefined): string | null => {
  const value = datetime?.trim();
  if (!value) return null;
  if (/^\d{12,}$/.test(value)) return value.padEnd(17, '0').slice(0, 17);
  const match = value.match(/^(\d{4})[.\-/](\d{2})[.\-/](\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (!match) return null;
  return `${match[1]}${match[2]}${match[3]}${match[4] ?? '00'}${match[5] ?? '00'}${match[6] ?? '00'}`.padEnd(17, '0').slice(0, 17);
};

export const sortPhotoPaths = (
  paths: string[],
  {
    sort,
    shotTimes,
  }: {
    assetsByPath?: Map<string, SortableAsset>;
    sort: PhotoSortDirection;
    shotTimes?: Map<string, string | null>;
  },
): string[] => {
  const descending = sort === 'shot-desc';
  const decorated = paths.map((path, index) => ({path, index}));
  decorated.sort((left, right) => {
    const leftShot = shotTimeKey(shotTimes?.get(left.path));
    const rightShot = shotTimeKey(shotTimes?.get(right.path));
    if (leftShot && rightShot && leftShot !== rightShot) {
      const earlier = leftShot < rightShot ? -1 : 1;
      return descending ? -earlier : earlier;
    }
    if (leftShot && !rightShot) return -1;
    if (!leftShot && rightShot) return 1;
    return left.index - right.index;
  });
  return decorated.map((item) => item.path);
};
