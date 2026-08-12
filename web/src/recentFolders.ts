const RECENT_FOLDERS_KEY = 'kiseki:recent-folders';
const MAX_RECENT_FOLDERS = 5;

export interface RecentFolder {
  name: string;
  path: string;
}

export const loadRecentFolders = (): RecentFolder[] => {
  if (typeof localStorage === 'undefined') return [];
  try {
    const value: unknown = JSON.parse(localStorage.getItem(RECENT_FOLDERS_KEY) ?? '[]');
    if (!Array.isArray(value)) return [];
    return value
      .filter((item): item is RecentFolder => (
        typeof item === 'object' && item !== null &&
        typeof (item as RecentFolder).name === 'string' &&
        typeof (item as RecentFolder).path === 'string'
      ))
      .slice(0, MAX_RECENT_FOLDERS);
  } catch {
    return [];
  }
};

export const rememberFolder = (folder: RecentFolder): RecentFolder[] => {
  const next = [folder, ...loadRecentFolders().filter((item) => item.path !== folder.path)]
    .slice(0, MAX_RECENT_FOLDERS);
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(RECENT_FOLDERS_KEY, JSON.stringify(next));
    } catch {
      // 最近使用只是快捷入口，存储不可用不应阻止打开素材夹。
    }
  }
  return next;
};
