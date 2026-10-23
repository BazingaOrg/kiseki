import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import {ArrowLeftRight, Columns2, Image as ImageIcon, Eye, RotateCcw, Undo2} from 'lucide-react';

import {MOOD_TAGS, SCENE_TAGS, getRoll, makerLabel} from '../../film/src/index.mjs';
import type {Roll, SourceLook} from '../../film/src/index.mjs';
import {saveFilm} from './api';
import {FilmCompare} from './FilmCompare';
import {usePhotoStrip} from './usePhotoStrip';
import {developPreview, seedFor} from './film-preview';
import {ALL_TAG, createFilmSaveQueue, effectiveChoice, filmViewAction, filmViewLabel, inverseFilmPatch, nextFilmViewMode, rollsForTag, swapFilmViewMode} from './film-state';
import type {FilmViewMode} from './film-state';
import type {TransitionEvent} from 'react';
import {basename, thumbUrl} from './media';
import type {AssetItem, FilmPatch, FilmSettings} from './types';

type Scope = 'roll' | 'photo';

const STAGE_WIDTH = 1280;
const CARD_WIDTH = 240;
const STRIP_WIDTH = 160;

type PreviewState = {key: string; url: string | null; error: string | null};

const usePreview = (url: string, roll: string | null, strength: number, sourceLook: SourceLook | null, grain: boolean, seed: number, date: string | null, enabled = true, retry = 0) => {
  const key = JSON.stringify([url, roll, strength, sourceLook, grain, seed, date, retry]);
  const [shown, setShown] = useState<PreviewState | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    developPreview({url, roll, strength, sourceLook, grain, seed, date})
      .then(async (next) => {
        if (!active) return;
        const image = new Image();
        image.src = next;
        await image.decode();
        if (active) setShown({key, url: next, error: null});
      })
      .catch(() => { if (active) setShown({key, url: null, error: '预览没能生成，当前显示原图。'}); });
    return () => { active = false; };
  }, [key, enabled]);
  const current = shown?.key === key ? shown : null;
  return {url: enabled ? current?.url ?? null : null, pending: !current, error: current?.error ?? null};
};

type FilmSource = {sourceLook: SourceLook | null; date: string | null};

const useFilmSource = (path: string, retry: number) => {
  const cache = useRef(new Map<string, FilmSource>());
  const key = JSON.stringify([path, retry]);
  const [state, setState] = useState<{key: string; value: FilmSource | null; error: string | null} | null>(null);
  useEffect(() => {
    const cached = cache.current.get(path);
    if (cached) { setState({key, value: cached, error: null}); return; }
    const controller = new AbortController();
    fetch(`/api/exif?path=${encodeURIComponent(path)}`, {signal: controller.signal})
      .then(async (res) => {
        if (!res.ok) throw new Error('metadata unavailable');
        return await res.json() as FilmSource;
      })
      .then((body) => {
        if (controller.signal.aborted) return;
        const value = {sourceLook: body.sourceLook ?? null, date: body.date ?? null};
        cache.current.set(path, value);
        setState({key, value, error: null});
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({key, value: null, error: '照片信息没能读取，请重试。'});
      });
    return () => controller.abort();
  }, [path, key]);
  const current = state?.key === key ? state : null;
  return {sourceLook: current?.value?.sourceLook ?? null, date: current?.value?.date ?? null, ready: Boolean(current?.value), error: current?.error ?? null};
};

type StageRequest = {
  originalSrc: string;
  photoName: string;
  roll: string | null;
  strength: number;
  sourceLook: SourceLook | null;
  date: string | null;
  seed: number;
  overridden: boolean;
};

type StageFrame = StageRequest & {effectSrc: string; imageSize: {width: number; height: number}};

const decodePreview = async (src: string) => {
  const image = new Image();
  image.src = src;
  await image.decode();
  return {width: image.naturalWidth, height: image.naturalHeight};
};

const useStagePreview = (request: StageRequest, enabled: boolean, retry: number) => {
  const key = JSON.stringify([request, retry]);
  const [frame, setFrame] = useState<{key: string; value: StageFrame} | null>(null);
  const [failure, setFailure] = useState<{key: string; message: string} | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    const generate = async () => {
      const effectSrc = await developPreview({url: request.originalSrc, roll: request.roll, strength: request.strength, sourceLook: request.sourceLook, grain: true, seed: request.seed, date: request.date});
      const [imageSize] = await Promise.all([decodePreview(request.originalSrc), decodePreview(effectSrc)]);
      if (active) { setFrame({key, value: {...request, effectSrc, imageSize}}); setFailure(null); }
    };
    generate().catch(() => { if (active) setFailure({key, message: '预览没能生成，请重试。'}); });
    return () => { active = false; };
  }, [key, enabled]);
  const error = failure?.key === key ? failure.message : null;
  return {frame: frame?.value ?? null, pending: !enabled || frame?.key !== key, error};
};

const FilmCard = ({roll, selected, photo, sourceLook, date, sourceReady, onPick}: {
  roll: Roll | null;
  selected: boolean;
  photo: AssetItem;
  sourceLook: SourceLook | null;
  date: string | null;
  sourceReady: boolean;
  onPick: () => void;
}) => {
  const preview = usePreview(thumbUrl(photo.path, CARD_WIDTH), roll?.id ?? null, 1, sourceLook, false, seedFor(photo.id), date, !roll || sourceReady);
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({block: 'nearest'});
  }, [selected]);
  const sameAsSource = Boolean(roll && sourceLook?.roll === roll.id);
  const maker = roll ? makerLabel(roll) : null;
  const reference = roll && maker && roll.ref.startsWith(`${maker} `) ? roll.ref.slice(maker.length + 1) : roll?.ref;
  return (
    <button ref={ref} type="button" className={selected ? 'film-card film-card-selected' : 'film-card'} aria-pressed={selected} onClick={onPick}>
      <span className="film-card-thumb">
        {preview.url ? <img src={preview.url} alt="" /> : null}
      </span>
      <span className="film-card-body">
        <span className="film-card-name">
          {roll ? roll.name : '原片'}
          {roll?.fidelity === 'measured' ? <span className="film-card-badge">实测还原</span> : null}
        </span>
        <span className="film-card-desc">{roll ? roll.desc : '不加胶片效果，保留照片本来的颜色。'}</span>
      </span>
      {roll ? <span className="film-card-ref">{maker} · {reference}</span> : null}
      {sameAsSource ? <span className="film-card-note">这张机内已是{roll!.name}，不会重复叠加</span> : null}
    </button>
  );
};

interface DarkroomProps {
  folder: string;
  photos: AssetItem[];
  settings: FilmSettings;
  onSettingsChange: (settings: FilmSettings) => void;
  onClose: () => void;
  visible: boolean;
  exiting: boolean;
  onReopen: () => void;
  onExitEnd: (event: TransitionEvent<HTMLElement>) => void;
}

export const Darkroom = ({folder, photos, settings, onSettingsChange, onClose, visible, exiting, onReopen, onExitEnd}: DarkroomProps) => {
  const [index, setIndex] = useState(0);
  const selectedIndex = useRef(0);
  const strip = usePhotoStrip(photos.length);
  const selectPhoto = useCallback((next: number, animate: boolean) => {
    const at = Math.max(0, Math.min(photos.length - 1, next));
    selectedIndex.current = at;
    setIndex(at);
    strip.follow(at, animate);
  }, [photos.length, strip.follow]);
  const [scope, setScope] = useState<Scope>('roll');
  const [tag, setTag] = useState(ALL_TAG);
  const [holding, setHolding] = useState(false);
  const [viewMode, setViewMode] = useState<FilmViewMode>('original-left');
  const [animateView, setAnimateView] = useState(false);
  const [previewRetry, setPreviewRetry] = useState(0);
  const dialogRef = useRef<HTMLDivElement>(null);
  const doneRef = useRef<HTMLButtonElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<FilmPatch[]>([]);
  const [pending, setPending] = useState(false);
  const [closing, setClosing] = useState(false);
  const [queue] = useState(() => createFilmSaveQueue(settings, (patch) => saveFilm(folder, patch), (next, busy, failure) => {
    onSettingsChange(next);
    setPending(busy);
    setError(failure);
    if (failure) setHistory([]);
  }));

  const close = useCallback(async () => {
    setClosing(true);
    if (await queue.flush()) onClose();
    setClosing(false);
  }, [queue, onClose]);

  const photo = photos[Math.min(index, photos.length - 1)];
  const source = useFilmSource(photo.path, previewRetry);
  const {sourceLook, date} = source;
  const current = effectiveChoice(settings, photo.id);
  const scoped = scope === 'roll' ? {roll: settings.roll, strength: settings.strength} : current;
  const strength = scoped.strength;
  const rolls = useMemo(() => rollsForTag(tag), [tag]);
  const choices = useMemo<(Roll | null)[]>(() => [null, ...rolls], [rolls]);

  const originalSrc = thumbUrl(photo.path, STAGE_WIDTH);
  const requestedFrame = {originalSrc, photoName: basename(photo.path), roll: current.roll, strength: current.strength, sourceLook, date, seed: seedFor(photo.id), overridden: current.overridden};
  const stage = useStagePreview(requestedFrame, !current.roll || source.ready, previewRetry);
  const displayed = stage.frame;
  const previewFailure = current.roll ? source.error ?? stage.error : stage.error;
  const previewError = previewFailure && displayed ? `${previewFailure}仍显示上次完成的预览。` : previewFailure;

  const cycleView = (pointerInitiated: boolean) => {
    const next = nextFilmViewMode(viewMode);
    setAnimateView(pointerInitiated && (viewMode === 'effect' || next === 'effect'));
    setViewMode(next);
  };

  const swapView = () => {
    setAnimateView(false);
    setViewMode(swapFilmViewMode);
  };

  const commit = useCallback((patch: FilmPatch, {record = true} = {}) => {
    const before = queue.current();
    if (record) setHistory((previous) => [...previous.slice(-49), inverseFilmPatch(before, patch)]);
    queue.enqueue(patch);
  }, [queue]);

  const scopedPatch = useCallback((choice: {roll?: string | null; strength?: number}): FilmPatch =>
    scope === 'roll' ? choice : {photo: {assetId: photo.id, ...choice}}, [scope, photo.id]);

  const pickRoll = useCallback((roll: string | null) => {
    commit(scopedPatch({roll}));
  }, [commit, scopedPatch]);

  const changeStrength = (value: number) => commit(scopedPatch({strength: value}));

  const undo = useCallback(() => {
    const last = history[history.length - 1];
    if (!last) return;
    setHistory((previous) => previous.slice(0, -1));
    commit(last, {record: false});
  }, [commit, history]);

  const step = useCallback((delta: number) => {
    const at = choices.findIndex((roll) => (roll?.id ?? null) === scoped.roll);
    const next = choices[(Math.max(0, at) + delta + choices.length) % choices.length];
    pickRoll(next?.id ?? null);
  }, [choices, pickRoll, scoped.roll]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key === 'Escape') { event.preventDefault(); void close(); return; }
      const target = event.target;
      if (target instanceof HTMLElement && (target.matches('input, textarea, select, [contenteditable="true"]') || target.closest('[role="slider"]'))) return;
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') { event.preventDefault(); step(1); }
      else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') { event.preventDefault(); step(-1); }
      else if (event.key === ']') { event.preventDefault(); selectPhoto(selectedIndex.current + 1, false); }
      else if (event.key === '[') { event.preventDefault(); selectPhoto(selectedIndex.current - 1, false); }
      else if (event.key === ' ' && !(target instanceof HTMLElement && target.closest('button, a'))) { event.preventDefault(); setHolding(true); }
      else if (event.key.toLowerCase() === 'z' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); undo(); }
    };
    const onKeyUp = (event: KeyboardEvent) => { if (event.key === ' ') setHolding(false); };
    const resetHolding = () => setHolding(false);
    window.addEventListener('blur', resetHolding);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('blur', resetHolding);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [close, selectPhoto, step, undo]);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    doneRef.current?.focus();
    return () => previousFocus?.focus();
  }, []);

  const trapFocus = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab') return;
    const elements = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex="0"]') ?? [])
      .filter((element) => element.getClientRects().length > 0);
    const first = elements[0];
    const last = elements[elements.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  };

  const currentRoll = displayed?.roll ? getRoll(displayed.roll) : null;
  const followLabel = settings.roll ? getRoll(settings.roll)?.name ?? '原片' : '原片';

  return createPortal(
    <div ref={dialogRef} className="darkroom" data-visible={visible} onPointerDownCapture={() => { if (exiting) onReopen(); }} onKeyDownCapture={(event) => { if (exiting && event.key !== 'Escape') onReopen(); }} onKeyDown={trapFocus} role="dialog" aria-modal="true" aria-label="胶片暗房">
      <header className="darkroom-header">
        <h2>胶片</h2>
        <div className="darkroom-scope" role="group" aria-label="应用范围">
          <button type="button" aria-pressed={scope === 'roll'} className={scope === 'roll' ? 'active' : ''} onClick={() => setScope('roll')}>整卷</button>
          <button type="button" aria-pressed={scope === 'photo'} className={scope === 'photo' ? 'active' : ''} onClick={() => setScope('photo')}>仅这张</button>
        </div>
        <p className="darkroom-scope-hint">
          {scope === 'roll' ? '选中的胶片会用在所有照片上，单独设置过的照片除外。' : '只改当前这张，其余照片不受影响。'}
        </p>
        <button type="button" className="darkroom-icon" aria-label="撤销" title="撤销 (⌘Z)" disabled={history.length === 0} onClick={undo}><Undo2 size={16} /></button>
        <button ref={doneRef} type="button" className="darkroom-done" title="完成 (Esc)" disabled={closing} onClick={() => void close()}>完成</button>
      </header>
      <div className="darkroom-body" onTransitionEnd={onExitEnd}>
        <div className="darkroom-stage">
          <div className="darkroom-photo">
            <FilmCompare
              key={`${displayed?.originalSrc ?? originalSrc}:${previewRetry}`}
              originalSrc={displayed?.originalSrc ?? originalSrc}
              effectSrc={displayed?.effectSrc ?? null}
              imageSize={displayed?.imageSize}
              alt={displayed?.photoName ?? basename(photo.path)}
              effectLabel={currentRoll?.name ?? '原图'}
              mode={displayed?.roll ? viewMode : 'effect'}
              animateView={animateView}
              holding={holding}
              busy={stage.pending && !previewError}
              error={previewError}
              onSwap={swapView}
            />
          </div>
          <div className="darkroom-stage-bar">
            <span className="darkroom-current">
              {currentRoll ? currentRoll.name : '原片'}
              {displayed?.overridden ? <span className="darkroom-tag">单独设置</span> : <span className="darkroom-tag darkroom-tag-quiet">跟随整卷</span>}
              {displayed?.sourceLook ? <span className="darkroom-tag darkroom-tag-quiet">机内：{displayed.sourceLook.label}</span> : null}
            </span>
            <div className="darkroom-preview-actions" role="group" aria-label="预览操作">
              <button
                type="button"
                className="darkroom-hold darkroom-view-cycle"
                title={`当前：${filmViewLabel(viewMode)}；点击${filmViewAction(viewMode)}`}
                disabled={!current.roll}
                onClick={(event) => cycleView(event.detail > 0)}
              >
                {viewMode === 'original-left' ? <ArrowLeftRight size={14} /> : viewMode === 'effect-left' ? <ImageIcon size={14} /> : <Columns2 size={14} />}
                <span>{filmViewAction(viewMode)}</span>
              </button>
              <button
                type="button"
                className="darkroom-hold"
                onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); setHolding(true); }}
                onKeyDown={(event) => { if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); setHolding(true); } }}
                onKeyUp={(event) => { if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); setHolding(false); } }}
                onBlur={() => setHolding(false)}
                onPointerUp={() => setHolding(false)}
                onPointerLeave={() => setHolding(false)}
                onPointerCancel={() => setHolding(false)}
              >
                <Eye size={14} />按住看原图
              </button>
            </div>
          </div>
          <div className="darkroom-controls">
            {previewError ? <button type="button" className="link-button" onClick={() => setPreviewRetry((value) => value + 1)}>重新预览</button> : null}
            <label className="darkroom-strength">
              <span>效果强度</span>
              <input type="range" min={0} max={1} step={0.05} value={strength} disabled={!scoped.roll} onChange={(event) => changeStrength(Number(event.target.value))} />
              <output>{Math.round(strength * 100)}%</output>
            </label>
            {current.overridden ? (
              <button type="button" className="link-button" onClick={() => commit({photo: {assetId: photo.id, inherit: true}})}>
                <RotateCcw size={13} />这张改回跟随整卷（{followLabel}）
              </button>
            ) : null}
          </div>
          <div className="darkroom-strip-section">
            <div className="darkroom-strip-meta"><span>照片</span><span role="status" aria-label={`第 ${index + 1} 张，共 ${photos.length} 张`}>{index + 1} / {photos.length}</span></div>
            <div className="darkroom-strip-window" data-before={strip.edges.left} data-after={strip.edges.right}>
              <ol ref={strip.ref} className="darkroom-strip" aria-label="照片">
                {photos.map((item, at) => {
                  const choice = effectiveChoice(settings, item.id);
                  const label = choice.roll ? getRoll(choice.roll)?.name ?? '' : '原片';
                  return (
                    <li key={item.id}>
                      <button type="button" aria-current={at === index} className={at === index ? 'active' : ''} onClick={(event) => selectPhoto(at, event.detail > 0)} title={basename(item.path)}>
                        <img src={thumbUrl(item.path, STRIP_WIDTH)} alt="" loading="lazy" />
                        <span className={choice.overridden ? 'darkroom-strip-label overridden' : 'darkroom-strip-label'}>{label}</span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            </div>
          </div>
        </div>
        <aside className="darkroom-films">
          <div className="darkroom-tags" role="group" aria-label="按场景或气质筛选">
            {[ALL_TAG, ...SCENE_TAGS, ...MOOD_TAGS].map((item) => (
              <button key={item} type="button" aria-pressed={tag === item} className={tag === item ? 'photo-sort-button photo-sort-button-active' : 'photo-sort-button'} onClick={() => setTag(item)}>{item}</button>
            ))}
          </div>
          <div className="darkroom-film-list">
            {choices.map((roll) => (
              <FilmCard
                key={roll?.id ?? 'none'}
                roll={roll}
                photo={photo}
                sourceLook={sourceLook}
                date={date}
                sourceReady={source.ready}
                selected={(roll?.id ?? null) === scoped.roll}
                onPick={() => pickRoll(roll?.id ?? null)}
              />
            ))}
          </div>
          <p className="darkroom-keys">← → 换胶片　[ ] 换照片　空格 看原图</p>
        </aside>
      </div>
      {pending ? <p className="darkroom-save-status" role="status">正在保存…</p> : null}
      {error ? <p className="darkroom-error" role="alert">没保存上：{error}{!pending ? <button type="button" onClick={onClose}>保留已保存设置并关闭</button> : null}</p> : null}
    </div>,
    document.body,
  );
};
