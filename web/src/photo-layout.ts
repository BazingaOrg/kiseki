export type PhotoLayout = 'masonry' | 'square';

export const PHOTO_LAYOUT_OPTIONS: {value: PhotoLayout; label: string}[] = [
  {value: 'masonry', label: '瀑布流'},
  {value: 'square', label: '方格'},
];

export const photoLayoutStorageKey = (folder: string) => `kiseki-photo-layout:${folder}`;

export const readPhotoLayout = (folder: string): PhotoLayout => {
  try {
    const value = localStorage.getItem(photoLayoutStorageKey(folder));
    if (value === 'masonry' || value === 'square') return value;
  } catch {}
  return 'masonry';
};
