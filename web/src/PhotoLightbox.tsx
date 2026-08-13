import {useEffect, useState} from 'react';
import {ChevronLeft, ChevronRight, RotateCcw, X, ZoomIn, ZoomOut} from 'lucide-react';
import Lightbox from 'yet-another-react-lightbox';
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

const PhotoLightbox = ({
  paths,
  index,
  onIndexChange,
  onClose,
}: {
  paths: string[];
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
}) => (
  <Lightbox
    className="kiseki-lightbox"
    open
    index={index}
    close={onClose}
    slides={paths.map(lightboxSlide)}
    plugins={[Counter, Zoom]}
    labels={{Previous: '上一张', Next: '下一张', Close: '关闭', 'Zoom in': '放大', 'Zoom out': '缩小'}}
    carousel={{finite: paths.length <= 1, imageFit: 'contain', padding: 0, preload: 1}}
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
    on={{view: ({index: next}) => onIndexChange(next)}}
    render={{
      iconPrev: () => <ChevronLeft aria-hidden="true" />,
      iconNext: () => <ChevronRight aria-hidden="true" />,
      iconClose: () => <X aria-hidden="true" />,
      buttonPrev: paths.length <= 1 ? () => null : undefined,
      buttonNext: paths.length <= 1 ? () => null : undefined,
      buttonZoom: (zoomRef) => <LightboxZoomControls zoomRef={zoomRef} />,
      slideFooter: ({slide}) =>
        slide.photoPath ? <ExifTag path={slide.photoPath} /> : null,
    }}
    styles={{container: {backgroundColor: 'rgba(12, 12, 14, 0.94)'}}}
  />
);

export default PhotoLightbox;
