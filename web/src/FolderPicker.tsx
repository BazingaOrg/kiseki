import {useEffect, useRef, useState} from 'react';
import {ChevronRight, Folder} from 'lucide-react';

import {createLatestGate} from './latest';
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
  // loadDirs 和 handleSelectFolder 共用同一个 gate ——
  // 两者操作重叠的界面状态(面包屑、列表、error),各用一个等于没修。
  const gate = useRef(createLatestGate()).current;

  const loadDirs = (targetPath: string) => {
    const ticket = gate.begin();
    setLoading(true);
    setError(null);
    fetch(`/api/dirs?path=${encodeURIComponent(targetPath)}`)
      .then((res) => {
        if (!res.ok) throw new Error('failed');
        return res.json();
      })
      .then((data: DirsResponse) => {
        if (gate.isCurrent(ticket)) setDirsResponse(data);
      })
      .catch(() => {
        if (gate.isCurrent(ticket)) setError('浏览这个文件夹时出了点问题。');
      })
      .finally(() => {
        if (gate.isCurrent(ticket)) setLoading(false);
      });
  };

  useEffect(() => {
    loadDirs('.');
  }, []);

  const handleSelectFolder = () => {
    if (!dirsResponse) return;
    const ticket = gate.begin();
    setSelecting(true);
    setError(null);
    fetch(`/api/project?path=${encodeURIComponent(dirsResponse.path)}`)
      .then((res) => {
        if (!res.ok) throw new Error('failed');
        return res.json();
      })
      .then((data: ProjectResponse) => {
        if (gate.isCurrent(ticket)) onProjectLoaded(data);
      })
      .catch(() => {
        if (gate.isCurrent(ticket)) setError('读取这个文件夹时出了点问题。');
      })
      .finally(() => {
        if (gate.isCurrent(ticket)) setSelecting(false);
      });
  };

  const crumbs = dirsResponse ? splitBreadcrumb(dirsResponse.path, dirsResponse.root) : [];

  return (
    <div className="folder-picker">
      {dirsResponse && (
        <nav className="breadcrumb" aria-label="当前位置">
          {crumbs.map((crumb, index) => (
            <span className="breadcrumb-crumb" key={crumb.path}>
              {index > 0 && <ChevronRight className="breadcrumb-sep" size={13} />}
              <button className="breadcrumb-item" onClick={() => loadDirs(crumb.path)}>
                {crumb.label}
              </button>
            </span>
          ))}
        </nav>
      )}

      {error && <p className="hint hint-error" role="alert">{error}</p>}

      {dirsResponse && (
        <ul className="folder-list" aria-busy={loading}>
          {dirsResponse.dirs.length === 0 && !loading && (
            <li className="folder-empty">这里没有下一层文件夹了。就选它，或者往回退。</li>
          )}
          {dirsResponse.dirs.map((dir) => (
            <li key={dir.path}>
              <button className="folder-item" onClick={() => loadDirs(dir.path)}>
                <Folder size={15} strokeWidth={1.5} className="folder-item-icon" />
                <span className="folder-item-name">{dir.name}</span>
                {dir.isProject && <span className="folder-badge" title="包含 tsuzuri 配置或 output 目录">检测到 tsuzuri 文件</span>}
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="folder-actions">
        <button className="primary-button" onClick={handleSelectFolder} disabled={selecting || !dirsResponse}>
          {selecting ? '正在读取…' : '就用这个文件夹'}
        </button>
      </div>
    </div>
  );
};
