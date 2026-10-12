import {useEffect, useMemo, useRef, useState, type ReactNode} from 'react';
import {ChevronLeft, ChevronRight, RotateCcw, Trash2, X, ZoomIn, ZoomOut} from 'lucide-react';
import Lightbox, {type ControllerRef} from 'yet-another-react-lightbox';
import Counter from 'yet-another-react-lightbox/plugins/counter';
import Zoom from 'yet-another-react-lightbox/plugins/zoom';
import 'yet-another-react-lightbox/styles.css';
import 'yet-another-react-lightbox/plugins/counter.css';

import {lightboxSlide} from './media';
import type {ExifResponse} from './types';

declare module 'yet-another-react-lightbox' {
  interface GenericSlide {
    photoPath?: string;
  }
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

const LightboxNavButton = ({
  direction,
  label,
  onNavigate,
  children,
}: {
  direction: 'prev' | 'next';
  label: string;
  onNavigate: () => void;
  children: ReactNode;
}) => (
  <button
    type="button"
    className={`yarl__button yarl__navigation_${direction}`}
    aria-label={label}
    onPointerDown={(event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      onNavigate();
    }}
    onClick={(event) => {
      event.stopPropagation();
      if (event.detail === 0) onNavigate();
    }}
  >
    {children}
  </button>
);

const PhotoLightbox = ({
  paths,
  index,
  onIndexChange,
  onClose,
  captions,
  onDelete,
  deleteName,
  deleteDisabled = false,
}: {
  paths: string[];
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
  captions?: Map<string, string>;
  onDelete?: () => void;
  deleteName?: string;
  deleteDisabled?: boolean;
}) => {
  const controllerRef = useRef<ControllerRef>(null);
  const slides = useMemo(() => paths.map(lightboxSlide), [paths]);
  const single = paths.length <= 1;
  const deleteButton = onDelete ? (
    <button
      key="delete"
      type="button"
      className="kiseki-lightbox-tool kiseki-lightbox-delete"
      title="删除"
      aria-label={deleteName ? `删除 ${deleteName}` : '删除这张照片'}
      disabled={deleteDisabled}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={onDelete}
    >
      <Trash2 aria-hidden="true" />
    </button>
  ) : null;
  return (
  <Lightbox
    className="kiseki-lightbox"
    open
    index={index}
    close={onClose}
    slides={slides}
    plugins={[Counter, Zoom]}
    labels={{Previous: '上一张', Next: '下一张', Close: '关闭', 'Zoom in': '放大', 'Zoom out': '缩小'}}
    carousel={{finite: single, imageFit: 'contain', padding: 0, preload: 1}}
    controller={{ref: controllerRef, closeOnBackdropClick: false}}
    toolbar={{buttons: deleteButton ? ['zoom', deleteButton, 'close'] : ['zoom', 'close']}}
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
    on={{view: ({index: next}) => onIndexChange(next)}}
    render={{
      iconClose: () => <X aria-hidden="true" />,
      buttonPrev: single ? () => null : () => (
        <LightboxNavButton direction="prev" label="上一张" onNavigate={() => controllerRef.current?.prev()}>
          <ChevronLeft aria-hidden="true" />
        </LightboxNavButton>
      ),
      buttonNext: single ? () => null : () => (
        <LightboxNavButton direction="next" label="下一张" onNavigate={() => controllerRef.current?.next()}>
          <ChevronRight aria-hidden="true" />
        </LightboxNavButton>
      ),
      buttonZoom: (zoomRef) => <LightboxZoomControls zoomRef={zoomRef} />,
      slideFooter: ({slide}) => slide.photoPath ? (
        <div className="kiseki-lightbox-footer">
          {captions?.get(slide.photoPath) && <p className="photo-caption-tag">{captions.get(slide.photoPath)}</p>}
          <ExifTag path={slide.photoPath} />
        </div>
      ) : null,
    }}
    styles={{container: {backgroundColor: 'rgba(12, 12, 14, 0.94)'}}}
  />
  );
};

export default PhotoLightbox;
