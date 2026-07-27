/**
 * 照片墙。相对旧版的三处改动:
 * 1. 素材照片(project.photos)也展示 —— 旧版只显示 output/stills,原始素材从未被消费,
 *    等于"看照片"这个页签看不到用户自己放进去的照片。
 * 2. 大图查看换成 yet-another-react-lightbox。焦点陷阱、键盘、触摸手势、缩放、
 *    ARIA 自己写必然做不全,这是明确的"用库不造轮子"。
 * 3. 大图底部挂 EXIF 展签,按需请求 /api/exif —— 与成片上印的是同一份格式化结果。
 */
import {useEffect, useState} from 'react';
import {ChevronLeft, ChevronRight, RotateCcw, X, ZoomIn, ZoomOut} from 'lucide-react';
import Lightbox from 'yet-another-react-lightbox';
import Counter from 'yet-another-react-lightbox/plugins/counter';
import Zoom from 'yet-another-react-lightbox/plugins/zoom';
import 'yet-another-react-lightbox/styles.css';
import 'yet-another-react-lightbox/plugins/counter.css';

import {basename, mediaUrl, thumbUrl} from './media';
import type {AssetItem, ExifResponse, ProjectResponse} from './types';

// 把原始路径挂在 slide 上,让 render.slideFooter 从回调参数里取 —— 不要读闭包里的
// 当前 index:lightbox 会同时挂载前后各若干张幻灯片,它们都会拿到同一个 index,
// 于是每翻一页就发出 3~5 个重复的 /api/exif 请求,而且相邻页挂着当前页的 EXIF;
// 加上 view 回调是在切换动画结束后才触发,翻页途中还会闪一下上一张的参数。
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
    <div className="tsuzuri-lightbox-zoom-controls" aria-label="图片缩放工具">
      <button type="button" className="tsuzuri-lightbox-tool" title="缩小" aria-label="缩小" onClick={zoomRef.zoomOut} disabled={!canZoomOut}>
        <ZoomOut aria-hidden="true" />
      </button>
      <button
        type="button"
        className="tsuzuri-lightbox-tool"
        title="复位缩放"
        aria-label="复位缩放"
        onClick={() => zoomRef.changeZoom(zoomRef.minZoom)}
        disabled={!canZoomOut}
      >
        <RotateCcw aria-hidden="true" />
      </button>
      <button type="button" className="tsuzuri-lightbox-tool" title="放大" aria-label="放大" onClick={zoomRef.zoomIn} disabled={!canZoomIn}>
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

export const PhotoGrid = ({project, groups: suppliedGroups, busy = false, onRename, onDelete}: PhotoGridProps) => {
  const [open, setOpen] = useState<OpenState | null>(null);

  const allGroups: PhotoGroup[] = suppliedGroups ?? [
    {
      key: 'stills',
      title: '导出作品',
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
          <div className="photo-grid">
            {group.paths.map((photoPath, index) => <PhotoItem
              key={photoPath}
              path={photoPath}
              asset={assetsByPath.get(photoPath)}
              busy={busy}
              onOpen={() => setOpen({groupKey: group.key, index})}
              onRename={onRename}
              onDelete={onDelete}
            />)}
          </div>
        </div>;
      })}

      {activeGroup && open && (
        <Lightbox
          className="tsuzuri-lightbox"
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
