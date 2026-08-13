import {lazy, Suspense, useEffect, useRef, useState} from 'react';

import {basename, thumbUrl} from './media';
import type {AssetItem, ProjectResponse} from './types';

const PhotoLightbox = lazy(() => import('./PhotoLightbox'));

export interface PhotoGroup {
  key: string;
  title: string;
  hint: string;
  paths: string[];
  assets?: AssetItem[];
  showCount?: boolean;
  showHeader?: boolean;
}

interface OpenState {
  groupKey: string;
  index: number;
}

interface PhotoGridProps {
  project: ProjectResponse;
  groups?: PhotoGroup[];
  busy?: boolean;
  onRename?: (item: AssetItem, stem: string) => void;
  onDelete?: (item: AssetItem) => void;
}

const PhotoItem = ({path, asset, busy, onOpen, onRename, onDelete}: {path: string; asset?: AssetItem; busy: boolean; onOpen: () => void; onRename?: (item: AssetItem, stem: string) => void; onDelete?: (item: AssetItem) => void}) => {
  const [editing, setEditing] = useState(false);
  const name = asset?.name ?? basename(path);
  const extensionIndex = name.lastIndexOf('.');
  const extension = extensionIndex > 0 ? name.slice(extensionIndex) : '';
  const originalStem = extension ? name.slice(0, -extension.length) : name;
  const [stem, setStem] = useState(originalStem);
  const disabled = busy || asset?.manageable === false;

  return (
    <article className="photo-item">
      <button className="photo-card" onClick={onOpen} aria-label={`查看 ${name}`}>
        <img src={thumbUrl(path, 400)} alt="" loading="lazy" decoding="async" />
      </button>
      <div className="photo-item-meta">
        {editing ? <input className="asset-rename-input" value={stem} onChange={(event) => setStem(event.target.value)} aria-label={`重命名 ${name}`} /> : <span className="photo-item-name" title={name}>{name}</span>}
        {asset && (onRename || onDelete) && <span className="asset-actions photo-item-actions">
          {editing ? <>
            <button type="button" className="link-button" disabled={disabled || !stem.trim()} onClick={() => { onRename?.(asset, stem); setEditing(false); }}>确认</button>
            <button type="button" className="link-button" onClick={() => { setStem(originalStem); setEditing(false); }}>取消</button>
          </> : <>
            <button type="button" className="link-button" disabled={disabled || !onRename} title={asset.actionHint ?? undefined} aria-label={`改名 ${name}`} onClick={() => setEditing(true)}>改名</button>
            <button type="button" className="link-button asset-delete" disabled={disabled || !onDelete} title={asset.actionHint ?? undefined} aria-label={`删除 ${name}`} onClick={() => onDelete?.(asset)}>删除</button>
          </>}
        </span>}
      </div>
    </article>
  );
};

/**
 * 大分组(数千张)全量挂载 DOM 会让整页卡死:按批挂载,哨兵进入视口(提前
 * 600px 预取)时再追加一批,直到渲染完。paths 本身不裁剪 —— lightbox 的
 * 导航索引和计数始终基于完整列表,分批只影响 DOM 挂载量。
 */
const PHOTO_CHUNK_SIZE = 150;

const PhotoChunkGrid = ({paths, assetsByPath, busy, onOpen, onRename, onDelete}: {
  paths: string[];
  assetsByPath: Map<string, AssetItem>;
  busy: boolean;
  onOpen: (index: number) => void;
  onRename?: (item: AssetItem, stem: string) => void;
  onDelete?: (item: AssetItem) => void;
}) => {
  const [limit, setLimit] = useState(PHOTO_CHUNK_SIZE);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setLimit((current) => {
          const next = Math.min(current + PHOTO_CHUNK_SIZE, paths.length);
          if (next >= paths.length) observer.disconnect();
          return next;
        });
      },
      {rootMargin: '600px 0px'},
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [paths.length]);

  const done = limit >= paths.length;

  return (
    <>
      <div className="photo-grid">
        {paths.slice(0, limit).map((photoPath, index) => <PhotoItem
          key={photoPath}
          path={photoPath}
          asset={assetsByPath.get(photoPath)}
          busy={busy}
          onOpen={() => onOpen(index)}
          onRename={onRename}
          onDelete={onDelete}
        />)}
      </div>
      {/* 哨兵始终挂载:渲染完(或列表又变长)时 effect 会重建观察,不依赖条件挂载 */}
      {!done && <div ref={sentinelRef} className="photo-grid-sentinel" aria-hidden="true" />}
    </>
  );
};

export const PhotoGrid = ({project, groups: suppliedGroups, busy = false, onRename, onDelete}: PhotoGridProps) => {
  const [open, setOpen] = useState<OpenState | null>(null);

  const allGroups: PhotoGroup[] = suppliedGroups ?? [
    {
      key: 'stills',
      title: '导出静态图',
      hint: '按成片同款视觉导出的静态图',
      paths: project.output.stills,
    },
    {
      key: 'photos',
      title: '素材照片',
      hint: '这个文件夹里的原始照片',
      paths: project.photos,
    },
  ];
  const groups = allGroups.filter((group) => group.paths.length > 0);

  const activeGroup = groups.find((group) => group.key === open?.groupKey) ?? null;

  return (
    <div className="photo-groups">
      {groups.map((group) => {
        const assetsByPath = new Map(group.assets?.map((item) => [item.path, item]));
        return <div className="photo-group" key={group.key}>
          {group.showHeader !== false && <div className="photo-group-head">
            <h3>{group.title}</h3>
            <span className="section-meta">
              {group.showCount !== false && `${group.paths.length} 张 · `}{group.hint}
            </span>
          </div>}
          <PhotoChunkGrid
            paths={group.paths}
            assetsByPath={assetsByPath}
            busy={busy}
            onOpen={(index) => setOpen({groupKey: group.key, index})}
            onRename={onRename}
            onDelete={onDelete}
          />
        </div>;
      })}

      {activeGroup && open && (
        <Suspense fallback={null}>
          <PhotoLightbox
            paths={activeGroup.paths}
            index={open.index}
            onIndexChange={(index) => setOpen({groupKey: activeGroup.key, index})}
            onClose={() => setOpen(null)}
          />
        </Suspense>
      )}
    </div>
  );
};
