import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import {Eye, RotateCcw, Undo2, X} from 'lucide-react';

import {MOOD_TAGS, SCENE_TAGS, getRoll, makerLabel} from '../../film/src/index.mjs';
import type {Roll, SourceLook} from '../../film/src/index.mjs';
import {saveFilm} from './api';
import {developPreview, seedFor} from './film-preview';
import {ALL_TAG, applyFilmPatch, effectiveChoice, inverseFilmPatch, rollsForTag} from './film-state';
import {basename, thumbUrl} from './media';
import type {AssetItem, FilmPatch, FilmSettings} from './types';

type Scope = 'roll' | 'photo';

const STAGE_WIDTH = 1280;
const CARD_WIDTH = 240;
const STRIP_WIDTH = 160;
const STRENGTH_DEBOUNCE_MS = 300;

const usePreview = (url: string, roll: string | null, strength: number, sourceLook: SourceLook | null, grain: boolean, seed: number) => {
  const [shown, setShown] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    developPreview({url, roll, strength, sourceLook, grain, seed})
      .then((next) => { if (active) setShown(next); })
      .catch(() => { if (active) setShown(url); });
    return () => { active = false; };
  }, [url, roll, strength, sourceLook, grain, seed]);
  return shown;
};

const useSourceLook = (path: string | undefined) => {
  const [looks, setLooks] = useState<Record<string, SourceLook | null>>({});
  useEffect(() => {
    if (!path || path in looks) return;
    const controller = new AbortController();
    fetch(`/api/exif?path=${encodeURIComponent(path)}`, {signal: controller.signal})
      .then((res) => (res.ok ? res.json() : null))
      .then((body: {sourceLook?: SourceLook | null} | null) => setLooks((previous) => ({...previous, [path]: body?.sourceLook ?? null})))
      .catch(() => undefined);
    return () => controller.abort();
  }, [path, looks]);
  return path ? looks[path] ?? null : null;
};

const FilmCard = ({roll, selected, photo, sourceLook, onPick}: {
  roll: Roll | null;
  selected: boolean;
  photo: AssetItem;
  sourceLook: SourceLook | null;
  onPick: () => void;
}) => {
  const preview = usePreview(thumbUrl(photo.path, CARD_WIDTH), roll?.id ?? null, 1, sourceLook, false, seedFor(photo.id));
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({block: 'nearest'});
  }, [selected]);
  const sameAsSource = Boolean(roll && sourceLook?.roll === roll.id);
  return (
    <button ref={ref} type="button" className={selected ? 'film-card film-card-selected' : 'film-card'} aria-pressed={selected} onClick={onPick}>
      <span className="film-card-thumb">
        {preview ? <img src={preview} alt="" /> : null}
        {roll ? <span className="film-card-maker">{makerLabel(roll)}</span> : null}
      </span>
      <span className="film-card-body">
        <span className="film-card-name">
          {roll ? roll.name : '原片'}
          {roll?.fidelity === 'measured' ? <span className="film-card-badge">实测还原</span> : null}
        </span>
        <span className="film-card-desc">{roll ? roll.desc : '不加胶片效果，保留照片本来的颜色。'}</span>
        {roll ? <span className="film-card-ref">灵感：{roll.ref}</span> : null}
        {sameAsSource ? <span className="film-card-note">这张机内已是{roll!.name}，不会重复叠加</span> : null}
      </span>
    </button>
  );
};

interface DarkroomProps {
  folder: string;
  photos: AssetItem[];
  settings: FilmSettings;
  onSettingsChange: (settings: FilmSettings) => void;
  onClose: () => void;
}

export const Darkroom = ({folder, photos, settings, onSettingsChange, onClose}: DarkroomProps) => {
  const [index, setIndex] = useState(0);
  const [scope, setScope] = useState<Scope>('roll');
  const [tag, setTag] = useState(ALL_TAG);
  const [holding, setHolding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<FilmPatch[]>([]);
  const [draftStrength, setDraftStrength] = useState<number | null>(null);
  const settingsRef = useRef(settings);
  const saving = useRef<Promise<unknown>>(Promise.resolve());
  const strengthTimer = useRef<number | null>(null);
  settingsRef.current = settings;

  const photo = photos[Math.min(index, photos.length - 1)];
  const sourceLook = useSourceLook(photo?.path);
  const current = effectiveChoice(settings, photo.id);
  const scoped = scope === 'roll' ? {roll: settings.roll, strength: settings.strength} : current;
  const strength = draftStrength ?? scoped.strength;
  const rolls = useMemo(() => rollsForTag(tag), [tag]);
  const choices = useMemo<(Roll | null)[]>(() => [null, ...rolls], [rolls]);

  const stageStrength = scope === 'roll' && current.overridden ? current.strength : draftStrength ?? current.strength;
  const stage = usePreview(thumbUrl(photo.path, STAGE_WIDTH), holding ? null : current.roll, stageStrength, sourceLook, true, seedFor(photo.id));

  const commit = useCallback((patch: FilmPatch, {record = true} = {}) => {
    const before = settingsRef.current;
    const optimistic = applyFilmPatch(before, patch);
    settingsRef.current = optimistic;
    onSettingsChange(optimistic);
    if (record) setHistory((previous) => [...previous.slice(-49), inverseFilmPatch(before, patch)]);
    setError(null);
    saving.current = saving.current.then(async () => {
      const result = await saveFilm(folder, patch);
      if (result.ok) return;
      settingsRef.current = before;
      onSettingsChange(before);
      setError(result.message);
    });
  }, [folder, onSettingsChange]);

  const scopedPatch = useCallback((choice: {roll?: string | null; strength?: number}): FilmPatch =>
    scope === 'roll' ? choice : {photo: {assetId: photo.id, ...choice}}, [scope, photo.id]);

  const pickRoll = useCallback((roll: string | null) => commit(scopedPatch({roll})), [commit, scopedPatch]);

  const changeStrength = (value: number) => {
    setDraftStrength(value);
    if (strengthTimer.current !== null) window.clearTimeout(strengthTimer.current);
    strengthTimer.current = window.setTimeout(() => {
      strengthTimer.current = null;
      setDraftStrength(null);
      commit(scopedPatch({strength: value}));
    }, STRENGTH_DEBOUNCE_MS);
  };

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
      if (event.target instanceof HTMLInputElement && event.target.type !== 'range') return;
      if (event.key === 'Escape') onClose();
      else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') { event.preventDefault(); step(1); }
      else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') { event.preventDefault(); step(-1); }
      else if (event.key === ']') setIndex((value) => Math.min(photos.length - 1, value + 1));
      else if (event.key === '[') setIndex((value) => Math.max(0, value - 1));
      else if (event.key === ' ') { event.preventDefault(); setHolding(true); }
      else if (event.key.toLowerCase() === 'z' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); undo(); }
    };
    const onKeyUp = (event: KeyboardEvent) => { if (event.key === ' ') setHolding(false); };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [onClose, photos.length, step, undo]);

  useEffect(() => () => { if (strengthTimer.current !== null) window.clearTimeout(strengthTimer.current); }, []);

  const currentRoll = current.roll ? getRoll(current.roll) : null;
  const followLabel = settings.roll ? getRoll(settings.roll)?.name ?? '原片' : '原片';

  return createPortal(
    <div className="darkroom" role="dialog" aria-modal="true" aria-label="胶片暗房">
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
        <button type="button" className="darkroom-icon" aria-label="完成" title="完成 (Esc)" onClick={onClose}><X size={18} /></button>
      </header>
      <div className="darkroom-body">
        <div className="darkroom-stage">
          <div className="darkroom-photo">
            {stage ? <img src={stage} alt={basename(photo.path)} /> : null}
          </div>
          <div className="darkroom-stage-bar">
            <span className="darkroom-current">
              {currentRoll ? currentRoll.name : '原片'}
              {current.overridden ? <span className="darkroom-tag">单独设置</span> : <span className="darkroom-tag darkroom-tag-quiet">跟随整卷</span>}
              {sourceLook ? <span className="darkroom-tag darkroom-tag-quiet">机内：{sourceLook.label}</span> : null}
            </span>
            <button
              type="button"
              className="darkroom-hold"
              onPointerDown={() => setHolding(true)}
              onPointerUp={() => setHolding(false)}
              onPointerLeave={() => setHolding(false)}
            >
              <Eye size={14} />按住看原图
            </button>
          </div>
          <div className="darkroom-controls">
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
          <ol className="darkroom-strip" aria-label="照片">
            {photos.map((item, at) => {
              const choice = effectiveChoice(settings, item.id);
              const label = choice.roll ? getRoll(choice.roll)?.name ?? '' : '原片';
              return (
                <li key={item.id}>
                  <button type="button" aria-current={at === index} className={at === index ? 'active' : ''} onClick={() => setIndex(at)} title={basename(item.path)}>
                    <img src={thumbUrl(item.path, STRIP_WIDTH)} alt="" loading="lazy" />
                    <span className={choice.overridden ? 'darkroom-strip-label overridden' : 'darkroom-strip-label'}>{label}</span>
                  </button>
                </li>
              );
            })}
          </ol>
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
                selected={(roll?.id ?? null) === scoped.roll}
                onPick={() => pickRoll(roll?.id ?? null)}
              />
            ))}
          </div>
          <p className="darkroom-keys">← → 换胶片　[ ] 换照片　空格 看原图</p>
        </aside>
      </div>
      {error ? <p className="darkroom-error" role="alert">没保存上：{error}</p> : null}
    </div>,
    document.body,
  );
};
