const RECENT_FOLDERS_KEY = 'kiseki:recent-folders';
const MAX_RECENT_FOLDERS = 5;

export interface RecentFolder {
  name: string;
  path: string;
}

const recentFolderPathKey = (value: string): string => {
  const slashPath = value.replace(/\\/g, '/');
  const drive = /^([A-Za-z]):(?:\/(.*))?$/.exec(slashPath);
  const prefix = drive
    ? `${drive[1].toLowerCase()}:/`
    : slashPath.startsWith('//')
      ? '//'
      : slashPath.startsWith('/')
        ? '/'
        : '';
  const body = drive ? drive[2] ?? '' : slashPath.slice(prefix.length);
  const parts: string[] = [];
  for (const part of body.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (parts.length > 0 && parts[parts.length - 1] !== '..') parts.pop();
      else if (!prefix) parts.push(part);
      continue;
    }
    parts.push(part);
  }
  return `${prefix}${parts.join('/')}` || '.';
};

const uniqueRecentFolders = (folders: RecentFolder[]): RecentFolder[] => {
  const seen = new Set<string>();
  return folders.filter((folder) => {
    const key = recentFolderPathKey(folder.path);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

export const loadRecentFolders = (): RecentFolder[] => {
  if (typeof localStorage === 'undefined') return [];
  try {
    const value: unknown = JSON.parse(localStorage.getItem(RECENT_FOLDERS_KEY) ?? '[]');
    if (!Array.isArray(value)) return [];
    return uniqueRecentFolders(value
      .filter((item): item is RecentFolder => (
        typeof item === 'object' && item !== null &&
        typeof (item as RecentFolder).name === 'string' &&
        typeof (item as RecentFolder).path === 'string'
      )))
      .slice(0, MAX_RECENT_FOLDERS);
  } catch {
    return [];
  }
};

export const rememberFolder = (folder: RecentFolder): RecentFolder[] => {
  const next = uniqueRecentFolders([folder, ...loadRecentFolders()])
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
