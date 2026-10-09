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
