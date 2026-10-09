import {useEffect, useRef, useState} from 'react';

import {previewSignature} from './api';

const DRAW_SPAN = 68;
const CYCLE_SECONDS = 3.2;

const playSignature = (svg: SVGSVGElement) => {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return () => {};
  const paths = [...svg.querySelectorAll('path')];
  if (!paths.length) return () => {};
  const lengths = paths.map((path) => {
    try {
      return Math.max(path.getTotalLength(), 1);
    } catch {
      return 1;
    }
  });
  const total = lengths.reduce((sum, length) => sum + length, 0);
  const viewHeight = Number((svg.getAttribute('viewBox') || '').split(/[\s,]+/)[3]) || 228;
  const pen = (viewHeight / 32).toFixed(2);
  let elapsed = 0;
  const rules = paths.map((path, index) => {
    const length = lengths[index];
    const start = (elapsed / total) * DRAW_SPAN;
    elapsed += length;
    const end = (elapsed / total) * DRAW_SPAN;
    const dash = length.toFixed(2);
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', pen);
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    path.setAttribute('stroke-dasharray', `${dash} ${dash}`);
    path.setAttribute('stroke-dashoffset', dash);
    path.style.animation = `signature-preview-draw-${index} ${CYCLE_SECONDS}s linear infinite both, signature-preview-fill ${CYCLE_SECONDS}s linear infinite both`;
    return `@keyframes signature-preview-draw-${index}{0%,${start.toFixed(2)}%{stroke-dashoffset:${dash}}${end.toFixed(2)}%,100%{stroke-dashoffset:0}}`;
  });
  rules.push('@keyframes signature-preview-fill{0%,74%{fill:transparent}86%,100%{fill:currentColor}}');
  const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
  style.textContent = rules.join('');
  svg.prepend(style);
  return () => style.remove();
};

export const SignaturePreview = ({name}: {name: string}) => {
  const trimmed = name.trim();
  const frameRef = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!trimmed) {
      setSvg(null);
      setError(null);
      setPending(false);
      return;
    }
    const controller = new AbortController();
    setPending(true);
    const timer = window.setTimeout(() => {
      previewSignature(trimmed).then((result) => {
        if (controller.signal.aborted) return;
        setPending(false);
        if (!result.ok) {
          setSvg(null);
          setError(result.message);
          return;
        }
        if (!result.data.svg.startsWith('<svg ') || result.data.svg.includes('<script')) {
          setSvg(null);
          setError('签名没有生成');
          return;
        }
        setError(null);
        setSvg(result.data.svg);
      });
    }, 280);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [trimmed]);

  useEffect(() => {
    const node = frameRef.current?.querySelector('svg');
    if (!node) return;
    return playSignature(node);
  }, [svg]);

  if (!trimmed) return null;
  if (error) return <p className="hint hint-error">{error}</p>;
  if (!svg) return <p className="make-field-hint">{pending ? '正在写签名…' : ''}</p>;
  return (
    <div className="signature-preview" aria-label="签名预览" ref={frameRef}>
      <div dangerouslySetInnerHTML={{__html: svg}} />
    </div>
  );
};
