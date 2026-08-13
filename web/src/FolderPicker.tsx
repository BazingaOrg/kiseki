import {useEffect, useRef, useState, type KeyboardEvent} from 'react';
import {ChevronRight, Clock3, Folder} from 'lucide-react';

import {createLatestGate} from './latest';
import {loadRecentFolders, rememberFolder, type RecentFolder} from './recentFolders';
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
  const [columns, setColumns] = useState<DirsResponse[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [recentFolders, setRecentFolders] = useState<RecentFolder[]>(loadRecentFolders);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selecting, setSelecting] = useState(false);
  const pendingFocusColumn = useRef<number | null>(null);
  // loadDirs 和 handleSelectFolder 共用同一个 gate ——
  // 两者操作重叠的界面状态(面包屑、列表、error),各用一个等于没修。
  const gate = useRef(createLatestGate()).current;

  const loadDirs = (targetPath: string, parentColumn = -1) => {
    const ticket = gate.begin();
    const previousSelectedPath = selectedPath;
    if (parentColumn >= 0) setSelectedPath(targetPath);
    setLoading(true);
    setError(null);
    fetch(`/api/dirs?path=${encodeURIComponent(targetPath)}`)
      .then((res) => {
        if (!res.ok) throw new Error('failed');
        return res.json();
      })
      .then((data: DirsResponse) => {
        if (!gate.isCurrent(ticket)) return;
        setColumns((current) => parentColumn < 0 ? [data] : [...current.slice(0, parentColumn + 1), data]);
        setSelectedPath(data.path);
      })
      .catch(() => {
        if (!gate.isCurrent(ticket)) return;
        pendingFocusColumn.current = null;
        setSelectedPath(previousSelectedPath);
        setError('浏览这个文件夹时出了点问题。');
      })
      .finally(() => {
        if (gate.isCurrent(ticket)) setLoading(false);
      });
  };

  useEffect(() => {
    loadDirs('.');
  }, []);

  useEffect(() => {
    const columnIndex = pendingFocusColumn.current;
    if (columnIndex === null || columns.length <= columnIndex) return;
    pendingFocusColumn.current = null;
    document.querySelectorAll<HTMLElement>('.folder-column')[columnIndex]?.querySelector<HTMLElement>('.folder-item')?.focus();
  }, [columns]);

  const handleSelectFolder = (targetPath = selectedPath) => {
    if (!targetPath) return;
    const ticket = gate.begin();
    setSelecting(true);
    setError(null);
    fetch(`/api/project?path=${encodeURIComponent(targetPath)}`)
      .then((res) => {
        if (!res.ok) throw new Error('failed');
        return res.json();
      })
      .then((data: ProjectResponse) => {
        if (!gate.isCurrent(ticket)) return;
        setRecentFolders(rememberFolder({name: data.name, path: data.path}));
        onProjectLoaded(data);
      })
      .catch(() => {
        if (gate.isCurrent(ticket)) setError('读取这个文件夹时出了点问题。');
      })
      .finally(() => {
        if (gate.isCurrent(ticket)) setSelecting(false);
      });
  };

  const handleNativeOpen = async () => {
    setSelecting(true); setError(null);
    try {
      const selected = await window.kisekiDesktop?.openProject();
      if (selected) handleSelectFolder(selected.path);
    } catch { setError('无法打开这个项目。'); setSelecting(false); }
  };

  const root = columns[0]?.root;
  const visibleRecentFolders = root
    ? recentFolders.filter((folder) => folder.path === root || folder.path.startsWith(root + pathSeparator(root)))
    : [];
  const crumbs = selectedPath && root ? splitBreadcrumb(selectedPath, root) : [];
  const selectedName = crumbs[crumbs.length - 1]?.label ?? '';

  const handleFolderKeyDown = (event: KeyboardEvent<HTMLButtonElement>, columnIndex: number, dirPath: string) => {
    const items = Array.from(event.currentTarget.closest('.folder-column')?.querySelectorAll<HTMLButtonElement>('.folder-item') ?? []);
    const itemIndex = items.indexOf(event.currentTarget);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const offset = event.key === 'ArrowDown' ? 1 : -1;
      items[(itemIndex + offset + items.length) % items.length]?.focus();
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      pendingFocusColumn.current = columnIndex + 1;
      loadDirs(dirPath, columnIndex);
    } else if (event.key === 'ArrowLeft' && columnIndex > 0) {
      event.preventDefault();
      document.querySelectorAll<HTMLElement>('.folder-column')[columnIndex - 1]?.querySelector<HTMLElement>('.folder-item[aria-selected="true"]')?.focus();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      handleSelectFolder(dirPath);
    }
  };

  return (
    <div className="folder-picker" onDragOver={(event) => { if (window.kisekiDesktop) event.preventDefault(); }} onDrop={async (event) => {
      if (!window.kisekiDesktop) return;
      event.preventDefault();
      const file = event.dataTransfer.files[0];
      if (!file) return;
      setSelecting(true); setError(null);
      try { const selected = await window.kisekiDesktop.openDroppedProject(file); handleSelectFolder(selected.path); }
      catch { setError('无法打开拖入的项目文件夹。'); setSelecting(false); }
    }}>
      {window.kisekiDesktop && <button className="primary-button" disabled={selecting} onClick={handleNativeOpen}><Folder size={16} />打开项目</button>}
      {error && <p className="hint hint-error" role="alert">{error}</p>}

      {visibleRecentFolders.length > 0 && (
        <section className="recent-folders" aria-labelledby="recent-folders-title">
          <h2 id="recent-folders-title">最近使用</h2>
          <div className="recent-folder-list">
            {visibleRecentFolders.map((folder) => (
              <button className="recent-folder" key={folder.path} onClick={() => handleSelectFolder(folder.path)} title={folder.path}>
                <Clock3 size={14} strokeWidth={1.5} />
                <span>{folder.name}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {columns.length > 0 && (
        <nav className="breadcrumb" aria-label="当前位置">
          {crumbs.map((crumb, index) => (
            <span className="breadcrumb-crumb" key={crumb.path}>
              {index > 0 && <ChevronRight className="breadcrumb-sep" size={13} />}
              <button className="breadcrumb-item" onClick={() => loadDirs(crumb.path)}>{crumb.label}</button>
            </span>
          ))}
        </nav>
      )}

      {columns.length > 0 && (
        <div className="folder-columns" aria-busy={loading}>
          {columns.map((column, columnIndex) => (
            <section className="folder-column" key={column.path} aria-label={`${splitBreadcrumb(column.path, column.root).slice(-1)[0]?.label ?? column.path}中的文件夹`}>
              <ul className="folder-list">
                {column.dirs.length === 0 && (
                  <li className="folder-empty">没有下一层文件夹</li>
                )}
                {column.dirs.map((dir) => {
                  const isSelected = selectedPath === dir.path || columns[columnIndex + 1]?.path === dir.path;
                  return (
                    <li key={dir.path}>
                      <button
                        className="folder-item"
                        aria-selected={isSelected}
                        onClick={() => loadDirs(dir.path, columnIndex)}
                        onDoubleClick={() => handleSelectFolder(dir.path)}
                        onKeyDown={(event) => handleFolderKeyDown(event, columnIndex, dir.path)}
                      >
                        <Folder size={15} strokeWidth={1.5} className="folder-item-icon" />
                        <span className="folder-item-name">{dir.name}</span>
                        {dir.isProject && <span className="folder-project-mark" title="检测到 kiseki 文件" aria-label="检测到 kiseki 文件">●</span>}
                        <ChevronRight size={13} className="folder-item-chevron" aria-hidden="true" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}

      <div className="folder-actions">
        <span className="folder-selection" title={selectedPath ?? undefined}>{selectedPath ? `当前选择：${selectedName}` : '请选择一个文件夹'}</span>
        <button className="primary-button" onClick={() => handleSelectFolder()} disabled={selecting || !selectedPath}>
          {selecting ? '正在读取…' : selectedName ? `打开「${selectedName}」` : '打开文件夹'}
        </button>
      </div>
    </div>
  );
};
