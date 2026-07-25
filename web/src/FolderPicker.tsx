import {useEffect, useState} from 'react';

import type {DirsResponse, ProjectResponse} from './types';

const pathSeparator = (p: string): string => (p.includes('\\') && !p.includes('/') ? '\\' : '/');

// 面包屑只在沙箱根目录(root)及其下渲染——根之上的路径段点了必然 403,
// 不该展示成可点的按钮。
const splitBreadcrumb = (fullPath: string, root: string): {label: string; path: string}[] => {
  const sep = pathSeparator(fullPath);
  const parts = fullPath.split(sep).filter((part) => part.length > 0);
  const crumbs: {label: string; path: string}[] = [];
  let acc = fullPath.startsWith(sep) ? sep : '';
  parts.forEach((part, index) => {
    acc = index === 0 && !fullPath.startsWith(sep) ? part : acc + (acc.endsWith(sep) ? '' : sep) + part;
    crumbs.push({label: part, path: acc});
  });
  if (crumbs.length === 0) {
    crumbs.push({label: fullPath, path: fullPath});
  }
  const withinRoot = crumbs.filter((crumb) => crumb.path === root || crumb.path.startsWith(root + sep));
  return withinRoot.length > 0 ? withinRoot : crumbs.slice(-1);
};

interface FolderPickerProps {
  onProjectLoaded: (project: ProjectResponse) => void;
}

export const FolderPicker = ({onProjectLoaded}: FolderPickerProps) => {
  const [dirsResponse, setDirsResponse] = useState<DirsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selecting, setSelecting] = useState(false);

  const loadDirs = (targetPath: string) => {
    setLoading(true);
    setError(null);
    fetch(`/api/dirs?path=${encodeURIComponent(targetPath)}`)
      .then((res) => {
        if (!res.ok) throw new Error('failed');
        return res.json();
      })
      .then((data: DirsResponse) => setDirsResponse(data))
      .catch(() => setError('浏览这个文件夹时出了点问题。'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadDirs('.');
  }, []);

  const handleSelectFolder = () => {
    if (!dirsResponse) return;
    setSelecting(true);
    setError(null);
    fetch(`/api/project?path=${encodeURIComponent(dirsResponse.path)}`)
      .then((res) => {
        if (!res.ok) throw new Error('failed');
        return res.json();
      })
      .then((data: ProjectResponse) => onProjectLoaded(data))
      .catch(() => setError('读取这个文件夹时出了点问题。'))
      .finally(() => setSelecting(false));
  };

  return (
    <div className="folder-picker">
      {dirsResponse && (
        <div className="breadcrumb">
          {splitBreadcrumb(dirsResponse.path, dirsResponse.root).map((crumb, index, arr) => (
            <span key={crumb.path}>
              <button className="breadcrumb-item" onClick={() => loadDirs(crumb.path)}>
                {crumb.label}
              </button>
              {index < arr.length - 1 && <span className="breadcrumb-sep">/</span>}
            </span>
          ))}
        </div>
      )}

      {loading && <p className="hint">正在浏览文件夹…</p>}
      {error && <p className="hint hint-error">{error}</p>}

      {!loading && dirsResponse && (
        <>
          <ul className="folder-list">
            {dirsResponse.dirs.length === 0 && <li className="hint">这里没有更多文件夹了。</li>}
            {dirsResponse.dirs.map((dir) => (
              <li key={dir.path}>
                <button className="folder-item" onClick={() => loadDirs(dir.path)}>
                  {dir.isProject && <span className="project-dot" />}
                  {dir.name}
                </button>
              </li>
            ))}
          </ul>

          <div className="folder-actions">
            <button className="primary-button" onClick={handleSelectFolder} disabled={selecting}>
              {selecting ? '正在读取…' : '选择这个文件夹'}
            </button>
          </div>
        </>
      )}
    </div>
  );
};
