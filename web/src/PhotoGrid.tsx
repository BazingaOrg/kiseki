import {lazy, Suspense, useEffect, useId, useRef, useState} from 'react';
import {ArrowDown, ArrowUp, Columns3, LayoutGrid} from 'lucide-react';

import {basename, thumbUrl} from './media';
import {captionHintDraftKey, openPhotoIndex, type PhotoOpenState} from './photo-grid-state';
import {PHOTO_LAYOUT_OPTIONS, photoLayoutStorageKey, readPhotoLayout, type PhotoLayout} from './photo-layout';
import {PHOTO_SORT_LABELS, photoSortStorageKey, readPhotoSort, sortPhotoPaths, togglePhotoSort, type PhotoSortDirection} from './photo-sort';
import type {AssetItem, ExifResponse, ProjectResponse} from './types';

const PhotoLightbox = lazy(() => import('./PhotoLightbox'));

const captionHintDrafts = new Map<string, string>();

export interface PhotoGroup {
  key: string;
  title: string;
  hint: string;
  paths: string[];
  assets?: AssetItem[];
  showCount?: boolean;
  showHeader?: boolean;
}

interface PhotoGridProps {
  project: ProjectResponse;
  groups?: PhotoGroup[];
  busy?: boolean;
  captionEnabled?: boolean;
  captionBlockedReason?: string | null;
  onDelete?: (item: AssetItem) => void;
  onCaption?: (item: AssetItem, hint: string) => Promise<string | null>;
  onDeleteAll?: (assets: AssetItem[]) => void;
}

const PhotoItem = ({
  path, asset, draftKey, busy, captionEnabled = false, captionBlockedReason = null, captionDescriptionId, onOpen, onDelete, onCaption,
}: {
  path: string;
  asset?: AssetItem;
  draftKey: string;
  busy: boolean;
  captionEnabled?: boolean;
  captionBlockedReason?: string | null;
  captionDescriptionId?: string;
  onOpen: () => void;
  onDelete?: (item: AssetItem) => void;
  onCaption?: (item: AssetItem, hint: string) => Promise<string | null>;
}) => {
  const [imageReady, setImageReady] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [hint, setHint] = useState(
    () => captionHintDrafts.get(draftKey) ?? asset?.captionHint ?? '',
  );
  const [captionError, setCaptionError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const name = asset?.name ?? basename(path);
  const disabled = busy || generating || asset?.manageable === false;
  const captionActionDisabled = busy || generating || !onCaption || !captionEnabled;

  useEffect(() => {
    const remembered = captionHintDrafts.get(draftKey);
    if (remembered != null) {
      setHint(remembered);
    } else {
      setHint(asset?.captionHint ?? '');
    }
    setDrafting(false);
    setCaptionError(null);
  }, [asset, asset?.captionHint, draftKey]);

  return (
    <article className="photo-item">
      <button className={imageReady ? 'photo-card photo-card-ready' : 'photo-card'} onClick={onOpen} aria-label={`查看 ${name}`}>
        <span className="photo-card-skeleton" aria-hidden="true" />
        <img src={thumbUrl(path, 400)} alt="" loading="lazy" decoding="async" onLoad={() => setImageReady(true)} onError={() => setImageReady(true)} />
      </button>
      <div className="photo-item-meta">
        {drafting && onCaption && asset ? (
          <form
            className="photo-item-caption-editor"
            onSubmit={(event) => {
              event.preventDefault();
              if (captionActionDisabled) return;
              captionHintDrafts.set(draftKey, hint);
              setGenerating(true);
              setCaptionError(null);
              void onCaption(asset, hint).then((error) => {
                setGenerating(false);
                if (error) setCaptionError(error);
                else {
                  captionHintDrafts.delete(draftKey);
                  setDrafting(false);
                }
              });
            }}
          >
            <input
              className="photo-caption-input"
              value={hint}
              maxLength={40}
              disabled={generating}
              placeholder="可补充人名、地点等画面里看不出的事（选填）"
              aria-label={`为 ${name} 补充旁白线索`}
              onChange={(event) => {
                const value = event.target.value;
                setHint(value);
                captionHintDrafts.set(draftKey, value);
              }}
            />
            <span className="asset-actions photo-item-actions">
              <button type="submit" className="link-button" disabled={captionActionDisabled}>{generating ? '生成中' : '生成'}</button>
              <button type="button" className="link-button" disabled={generating} onClick={() => {
                captionHintDrafts.delete(draftKey);
                setHint(asset.captionHint ?? '');
                setDrafting(false);
                setCaptionError(null);
              }}>取消</button>
            </span>
            {captionError && <p className="hint hint-error">{captionError}</p>}
          </form>
        ) : asset?.caption ? (
          <p className="photo-item-caption-wrap" data-tooltip={asset.caption} aria-label={asset.caption}><span className="photo-item-caption">{asset.caption}</span></p>
        ) : null}
        <span className="photo-item-name-wrap" data-tooltip={name} aria-label={name}><span className="photo-item-name">{name}</span></span>
        {asset && (onDelete || onCaption) && <span className="asset-actions photo-item-actions">
            {onCaption && (
              <button
                type="button"
                className="link-button"
                disabled={captionActionDisabled}
                title={captionEnabled ? undefined : captionBlockedReason ?? '图片旁白尚未配置'}
                aria-label={asset.caption ? `重写 ${name} 的旁白` : `为 ${name} 写旁白`}
                aria-describedby={!captionEnabled ? captionDescriptionId : undefined}
                onClick={() => {
                  setDrafting(true);
                  setCaptionError(null);
                  setHint(captionHintDrafts.get(draftKey) ?? asset.captionHint ?? hint);
                }}
              >
                {asset.caption ? '重写' : '写旁白'}
              </button>
            )}
            <button type="button" className="link-button asset-delete" disabled={disabled || !onDelete} title={asset.actionHint ?? undefined} aria-label={`删除 ${name}`} onClick={() => onDelete?.(asset)}>删除</button>
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
const deletableAssets = (group: PhotoGroup): AssetItem[] =>
  (group.assets ?? []).filter((item) => item.manageable !== false);

const PHOTO_CHUNK_SIZE = 60;

const PhotoChunkGrid = ({projectPath, paths, assetsByPath, busy, layout, captionEnabled, captionBlockedReason, captionDescriptionId, onOpen, onDelete, onCaption}: {
  projectPath: string;
  paths: string[];
  assetsByPath: Map<string, AssetItem>;
  busy: boolean;
  layout: PhotoLayout;
  captionEnabled?: boolean;
  captionBlockedReason?: string | null;
  captionDescriptionId?: string;
  onOpen: (path: string) => void;
  onDelete?: (item: AssetItem) => void;
  onCaption?: (item: AssetItem, hint: string) => Promise<string | null>;
}) => {
  const [limit, setLimit] = useState(PHOTO_CHUNK_SIZE);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const membershipKey = [...paths].sort().join('\n');

  useEffect(() => {
    setLimit(PHOTO_CHUNK_SIZE);
  }, [membershipKey]);

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
  }, [membershipKey, paths.length]);

  const done = limit >= paths.length;

  return (
    <>
      <div className={layout === 'masonry' ? 'photo-grid photo-grid-masonry' : 'photo-grid photo-grid-square'}>
        {paths.slice(0, limit).map((photoPath) => <PhotoItem
          key={photoPath}
          path={photoPath}
          asset={assetsByPath.get(photoPath)}
          draftKey={captionHintDraftKey(projectPath, photoPath)}
          busy={busy}
          captionEnabled={captionEnabled}
          captionBlockedReason={captionBlockedReason}
          captionDescriptionId={captionDescriptionId}
          onOpen={() => onOpen(photoPath)}
          onDelete={onDelete}
          onCaption={onCaption}
        />)}
      </div>
      {/* 哨兵始终挂载:渲染完(或列表又变长)时 effect 会重建观察,不依赖条件挂载 */}
      {!done && <div ref={sentinelRef} className="photo-grid-sentinel" aria-hidden="true" />}
    </>
  );
};

export const PhotoGrid = ({project, groups: suppliedGroups, busy = false, captionEnabled = false, captionBlockedReason = null, onDelete, onCaption, onDeleteAll}: PhotoGridProps) => {
  const [open, setOpen] = useState<PhotoOpenState | null>(null);
  const captionDescriptionId = useId();
  const [sort, setSort] = useState<PhotoSortDirection>(() => readPhotoSort(project.path));
  const [layout, setLayout] = useState<PhotoLayout>(() => readPhotoLayout(project.path));
  const [shotTimes, setShotTimes] = useState<Map<string, string | null>>(() => new Map());
  const shotTimesRef = useRef(shotTimes);
  shotTimesRef.current = shotTimes;

  useEffect(() => {
    setSort(readPhotoSort(project.path));
    setLayout(readPhotoLayout(project.path));
    const empty = new Map();
    shotTimesRef.current = empty;
    setShotTimes(empty);
  }, [project.path]);

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
  const pathKey = groups.map((group) => group.paths.join('\n')).join('\n\n');

  useEffect(() => {
    const paths = pathKey ? pathKey.split('\n\n').flatMap((group) => group.split('\n').filter(Boolean)) : [];
    const missing = paths.filter((path) => !shotTimesRef.current.has(path));
    if (missing.length === 0) return;
    const controller = new AbortController();
    let cancelled = false;
    const run = async () => {
      const batchSize = 24;
      const loaded = new Map(shotTimesRef.current);
      for (let offset = 0; offset < missing.length; offset += batchSize) {
        if (cancelled) return;
        const batch = missing.slice(offset, offset + batchSize);
        const entries = await Promise.all(batch.map(async (path) => {
          try {
            const res = await fetch(`/api/exif?path=${encodeURIComponent(path)}`, {signal: controller.signal});
            const data = res.ok ? await res.json() as ExifResponse : null;
            return [path, data?.shotTime ?? data?.exif?.datetime ?? null] as const;
          } catch (error: unknown) {
            if (error instanceof DOMException && error.name === 'AbortError') return null;
            return [path, null] as const;
          }
        }));
        if (cancelled) return;
        for (const entry of entries) {
          if (entry) loaded.set(entry[0], entry[1]);
        }
      }
      if (!cancelled) setShotTimes(loaded);
    };
    void run();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [sort, pathKey]);

  const activeGroup = groups.find((group) => group.key === open?.groupKey) ?? null;
  const activePaths = activeGroup
    ? sortPhotoPaths(activeGroup.paths, {assetsByPath: new Map(activeGroup.assets?.map((item) => [item.path, item])), sort, shotTimes})
    : [];
  const openPathAvailable = Boolean(open && activePaths.includes(open.path));
  const unavailableCaptionReason = onCaption && !captionEnabled
    ? captionBlockedReason ?? '图片旁白尚未配置。'
    : null;

  const chooseSort = (next: PhotoSortDirection) => {
    setSort(next);
    try {
      localStorage.setItem(photoSortStorageKey(project.path), next);
    } catch {}
  };

  const chooseLayout = (next: PhotoLayout) => {
    setLayout(next);
    try {
      localStorage.setItem(photoLayoutStorageKey(project.path), next);
    } catch {}
  };

  return (
    <div className="photo-groups">
      {groups.some((group) => group.paths.length > 1) && (
        <div className="photo-toolbar">
          <div className="photo-sort" role="group" aria-label="照片排序">
            <button
              type="button"
              className="photo-sort-button photo-sort-button-active"
              aria-pressed="true"
              aria-label={`照片排序：${PHOTO_SORT_LABELS[sort]}，点击切换为${PHOTO_SORT_LABELS[togglePhotoSort(sort)]}`}
              title={`点击切换为${PHOTO_SORT_LABELS[togglePhotoSort(sort)]}`}
              onClick={() => chooseSort(togglePhotoSort(sort))}
            >
              {sort === 'shot-asc' ? <ArrowDown size={13} aria-hidden="true" /> : <ArrowUp size={13} aria-hidden="true" />}
              <span>拍摄时间 · {PHOTO_SORT_LABELS[sort]}</span>
            </button>
          </div>
          <div className="photo-sort" role="group" aria-label="照片布局">
            {PHOTO_LAYOUT_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={layout === option.value ? 'photo-sort-button photo-sort-button-active' : 'photo-sort-button'}
                aria-pressed={layout === option.value}
                onClick={() => chooseLayout(option.value)}
              >
                {option.value === 'masonry' ? <Columns3 className="photo-layout-icon" size={13} aria-hidden="true" /> : <LayoutGrid className="photo-layout-icon" size={13} aria-hidden="true" />}
                <span>{option.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      {unavailableCaptionReason && (
        <p className="hint photo-caption-blocked" id={captionDescriptionId}>{unavailableCaptionReason}</p>
      )}
      {groups.map((group) => {
        const assetsByPath = new Map(group.assets?.map((item) => [item.path, item]));
        const removable = deletableAssets(group);
        const sortedPaths = sortPhotoPaths(group.paths, {assetsByPath, sort, shotTimes});
        return <div className="photo-group" key={group.key}>
          {group.showHeader !== false && <div className="photo-group-head">
            <h3>{group.title}</h3>
            <span className="section-meta">
              {group.showCount !== false && `${group.paths.length} 张 · `}{group.hint}
            </span>
            {onDeleteAll && removable.length > 1 && (
              <button
                type="button"
                className="link-button asset-delete photo-group-delete-all"
                disabled={busy}
                onClick={() => onDeleteAll(removable)}
              >
                全部删除
              </button>
            )}
          </div>}
          <PhotoChunkGrid
            projectPath={project.path}
            paths={sortedPaths}
            assetsByPath={assetsByPath}
            busy={busy}
            layout={layout}
            captionEnabled={captionEnabled}
            captionBlockedReason={captionBlockedReason}
            captionDescriptionId={unavailableCaptionReason ? captionDescriptionId : undefined}
            onOpen={(path) => setOpen({groupKey: group.key, path})}
            onDelete={onDelete}
            onCaption={onCaption}
          />
        </div>;
      })}

      {activeGroup && open && openPathAvailable && (
        <Suspense fallback={null}>
          <PhotoLightbox
            paths={activePaths}
            captions={new Map((activeGroup.assets ?? []).flatMap((item) => item.caption ? [[item.path, item.caption] as const] : []))}
            index={openPhotoIndex(activePaths, open.path)}
            onIndexChange={(index) => {
              const path = activePaths[index];
              if (path) setOpen({groupKey: activeGroup.key, path});
            }}
            onClose={() => setOpen(null)}
          />
        </Suspense>
      )}
    </div>
  );
};
