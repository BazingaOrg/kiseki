import {useEffect, useRef, useState} from 'react';
import {ChevronLeft, ChevronRight, RotateCcw, X, ZoomIn, ZoomOut} from 'lucide-react';
import Lightbox from 'yet-another-react-lightbox';
import Counter from 'yet-another-react-lightbox/plugins/counter';
import Zoom from 'yet-another-react-lightbox/plugins/zoom';
import 'yet-another-react-lightbox/styles.css';
import 'yet-another-react-lightbox/plugins/counter.css';

import {basename, mediaUrl, thumbUrl} from './media';
import type {AssetItem, ExifResponse, ProjectResponse} from './types';

// Lightbox 会同时挂载相邻幻灯片，路径必须来自当前 slide，不能读共享 index。
declare module 'yet-another-react-lightbox' {
  interface GenericSlide {
    photoPath?: string;
  }
}

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

interface LightboxZoomRef {
  zoom: number;
  minZoom: number;
  maxZoom: number;
  disabled: boolean;
  zoomIn: () => void;
  zoomOut: () => void;
  changeZoom: (targetZoom: number, rapid?: boolean) => void;
}

const LightboxZoomControls = ({zoomRef}: {zoomRef: LightboxZoomRef}) => {
  const canZoomOut = !zoomRef.disabled && zoomRef.zoom > zoomRef.minZoom;
  const canZoomIn = !zoomRef.disabled && zoomRef.zoom < zoomRef.maxZoom;

  return (
    <div className="kiseki-lightbox-zoom-controls" aria-label="图片缩放工具">
      <button type="button" className="kiseki-lightbox-tool" title="缩小" aria-label="缩小" onClick={zoomRef.zoomOut} disabled={!canZoomOut}>
        <ZoomOut aria-hidden="true" />
      </button>
      <button
        type="button"
        className="kiseki-lightbox-tool"
        title="复位缩放"
        aria-label="复位缩放"
        onClick={() => zoomRef.changeZoom(zoomRef.minZoom)}
        disabled={!canZoomOut}
      >
        <RotateCcw aria-hidden="true" />
      </button>
      <button type="button" className="kiseki-lightbox-tool" title="放大" aria-label="放大" onClick={zoomRef.zoomIn} disabled={!canZoomIn}>
        <ZoomIn aria-hidden="true" />
      </button>
    </div>
  );
};

const ExifTag = ({path}: {path: string}) => {
  const [exif, setExif] = useState<ExifResponse | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setExif(null);
    fetch(`/api/exif?path=${encodeURIComponent(path)}`, {signal: controller.signal})
      .then((res) => (res.ok ? res.json() : null))
      .then((data: ExifResponse | null) => {
        if (!controller.signal.aborted) setExif(data);
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === 'AbortError')) return undefined;
      });
    return () => {
      controller.abort();
    };
  }, [path]);

  // 没有 EXIF 的照片(截图、导出图)是常态,不占位、不报错,安静地什么都不显示
  if (!exif?.displayable || !exif.exif) return null;
  const {camera, lens, params, datetime} = exif.exif;

  return (
    <figcaption className="exif-tag">
      {camera && <span>{camera}</span>}
      {lens && <span>{lens}</span>}
      {params && params.length > 0 && <span>{params.join(' · ')}</span>}
      {datetime && <span className="exif-tag-time">{datetime}</span>}
    </figcaption>
  );
};

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
            <button className="link-button" disabled={disabled || !stem.trim()} onClick={() => { onRename?.(asset, stem); setEditing(false); }}>确认</button>
            <button className="link-button" onClick={() => { setStem(originalStem); setEditing(false); }}>取消</button>
          </> : <>
            <button className="link-button" disabled={disabled || !onRename} title={asset.actionHint ?? undefined} onClick={() => setEditing(true)}>改名</button>
            <button className="link-button" disabled={disabled || !onDelete} title={asset.actionHint ?? undefined} onClick={() => onDelete?.(asset)}>删除</button>
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
        <Lightbox
          className="kiseki-lightbox"
          open
          index={open.index}
          close={() => setOpen(null)}
          slides={activeGroup.paths.map((photoPath) => ({src: mediaUrl(photoPath), photoPath}))}
          plugins={[Counter, Zoom]}
          labels={{Previous: '上一张', Next: '下一张', Close: '关闭', 'Zoom in': '放大', 'Zoom out': '缩小'}}
          // 单张时不渲染左右翻页,避免出现点了没反应的箭头
          carousel={{finite: activeGroup.paths.length <= 1, imageFit: 'contain', padding: 0}}
          controller={{closeOnBackdropClick: false}}
          zoom={{zoomInMultiplier: 1.5, maxZoomPixelRatio: 1, scrollToZoom: false}}
          animation={{
            fade: 180,
            swipe: 230,
            navigation: 0,
            zoom: 160,
            easing: {
              fade: 'cubic-bezier(0.23, 1, 0.32, 1)',
              swipe: 'cubic-bezier(0.22, 1, 0.36, 1)',
              navigation: 'linear',
            },
          }}
          on={{view: ({index}) => setOpen({groupKey: activeGroup.key, index})}}
          render={{
            iconPrev: () => <ChevronLeft aria-hidden="true" />,
            iconNext: () => <ChevronRight aria-hidden="true" />,
            iconClose: () => <X aria-hidden="true" />,
            buttonPrev: activeGroup.paths.length <= 1 ? () => null : undefined,
            buttonNext: activeGroup.paths.length <= 1 ? () => null : undefined,
            buttonZoom: (zoomRef) => <LightboxZoomControls zoomRef={zoomRef} />,
            slideFooter: ({slide}) =>
              slide.photoPath ? <ExifTag path={slide.photoPath} /> : null,
          }}
          styles={{container: {backgroundColor: 'rgba(12, 12, 14, 0.94)'}}}
        />
      )}
    </div>
  );
};
