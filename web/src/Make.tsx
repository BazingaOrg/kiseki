import {useEffect, useId, useLayoutEffect, useMemo, useRef, useState} from 'react';
import type {ReactNode} from 'react';
import {Check, ChevronDown, Clapperboard, ImageDown, SlidersHorizontal} from 'lucide-react';

import {DEFAULT_OUTRO_TEXT} from '../../cli/branding.mjs';
import {FILTERS, getFilter} from '../../renderer/src/filters';
import type {Capability, Capabilities, Remedy} from './capabilities';
import {equivalentCommand} from './command';
import {JobPanel} from './JobPanel';
import {thumbUrl} from './media';
import {deletePreset, loadPresets, savePreset, type RenderPreset} from './presets';
import {LYRICS_MODE_EVENT, lyricsModeStorageKey, type ProjectResponse} from './types';
import {Blocked, CommandHint, Section} from './ui';
import {FieldHelp} from './FieldHelp';
import {SignaturePreview} from './SignaturePreview';
import type {JobOptions} from './useJob';
import {hasPhotoCaptionFailure, type useJob} from './useJob';
import {useTransitionPresence} from './useTransitionPresence';

type Kind = 'render' | 'still';

const KIND_VERB: Record<Kind, string> = {render: '渲染', still: '导出'};

const constrainOptions = (kind: Kind, options: JobOptions): JobOptions => ({
  ...options,
  format: options.format === 'portrait' ? 'portrait' : 'landscape',
  signatureName: typeof options.signatureName === 'string' ? options.signatureName : '',
  ...(kind === 'render' ? {
    draft: false,
    trim: 'full' as const,
    speed: 'balanced' as const,
    template: null,
    outroText: typeof options.outroText === 'string' ? options.outroText : DEFAULT_OUTRO_TEXT,
  } : {}),
});

const FORMAT_LABELS: {value: 'landscape' | 'portrait'; label: string}[] = [
  {value: 'landscape', label: '横版'},
  {value: 'portrait', label: '竖版'},
];

const FILTER_GROUPS = [
  {id: 'camera', label: '经典相机'},
  {id: 'film', label: '经典胶片'},
] as const;

const FilterPicker = ({value, onChange}: {value: string | null; onChange: (value: string | null) => void}) => {
  const [open, setOpen] = useState(false);
  const [menuPlacement, setMenuPlacement] = useState<'bottom' | 'top'>('bottom');
  const [menuMaxHeight, setMenuMaxHeight] = useState(320);
  const pickerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();
  const selectedFilter = FILTERS.find((filter) => filter.id === value);
  const selectedLegacyFilter = FILTERS.find((filter) => filter.id === value && filter.group === 'legacy');
  useEffect(() => {
    if (!open) return;
    const updateMenuPosition = () => {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const gap = 6;
      const viewportPadding = 8;
      const preferredHeight = Math.min(320, Math.floor(window.innerHeight * 0.52));
      const below = Math.max(0, window.innerHeight - rect.bottom - gap - viewportPadding);
      const above = Math.max(0, rect.top - gap - viewportPadding);
      const placeTop = below < Math.min(preferredHeight, 240) && above > below;
      const available = placeTop ? above : below;
      setMenuPlacement(placeTop ? 'top' : 'bottom');
      setMenuMaxHeight(Math.max(96, Math.min(preferredHeight, available)));
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!pickerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    updateMenuPosition();
    window.addEventListener('resize', updateMenuPosition);
    document.addEventListener('scroll', updateMenuPosition, true);
    document.addEventListener('pointerdown', onPointerDown);
    const selected = menuRef.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]');
    selected?.focus();
    return () => {
      window.removeEventListener('resize', updateMenuPosition);
      document.removeEventListener('scroll', updateMenuPosition, true);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open]);

  const choose = (next: string | null) => {
    onChange(next);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const moveFocus = (current: HTMLButtonElement, direction: 1 | -1) => {
    const items = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? [])];
    const index = items.indexOf(current);
    items[(index + direction + items.length) % items.length]?.focus();
  };

  const selectedLabel = selectedFilter?.label ?? '无';

  return (
    <div className="make-filter-picker" ref={pickerRef}>
      <button
        ref={triggerRef}
        type="button"
        className="make-filter-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span>{selectedLabel}</span>
        <ChevronDown className={open ? 'make-filter-chevron make-filter-chevron-open' : 'make-filter-chevron'} size={14} aria-hidden="true" />
      </button>
      {open && (
        <div ref={menuRef} id={listboxId} className={`make-filter-menu make-filter-menu-${menuPlacement}`} style={{maxHeight: `${menuMaxHeight}px`}} role="listbox" aria-label="滤镜选项" onKeyDown={(event) => {
          const current = event.target as HTMLButtonElement;
          if (event.key === 'Escape') {
            event.preventDefault();
            setOpen(false);
            triggerRef.current?.focus();
          } else if (event.key === 'ArrowDown') {
            event.preventDefault();
            moveFocus(current, 1);
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            moveFocus(current, -1);
          } else if (event.key === 'Home' || event.key === 'End') {
            event.preventDefault();
            const items = menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]');
            (event.key === 'Home' ? items?.[0] : items?.[items.length - 1])?.focus();
          }
        }}>
          <FilterOption value={null} label="无" selected={value === null} onChoose={choose} />
          {selectedLegacyFilter && (
            <div className="make-filter-group" role="group" aria-label="旧项目滤镜">
              <span className="make-filter-group-label">旧项目滤镜</span>
              <FilterOption value={selectedLegacyFilter.id} label={selectedLegacyFilter.label} selected={value === selectedLegacyFilter.id} onChoose={choose} />
            </div>
          )}
          {FILTER_GROUPS.map((group) => (
            <div className="make-filter-group" role="group" aria-label={group.label} key={group.id}>
              <span className="make-filter-group-label">{group.label}</span>
              {FILTERS.filter((filter) => filter.group === group.id).map((filter) => (
                <FilterOption key={filter.id} value={filter.id} label={filter.label} selected={value === filter.id} onChoose={choose} />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const FilterOption = ({value, label, selected, onChoose}: {value: string | null; label: string; selected: boolean; onChoose: (value: string | null) => void}) => (
  <button
    type="button"
    className={selected ? 'make-filter-option make-filter-option-selected' : 'make-filter-option'}
    role="option"
    aria-selected={selected}
    onClick={() => onChoose(value)}
  >
    <span>{label}</span>
    {selected && <Check size={14} aria-hidden="true" />}
  </button>
);

const RENDER_DEFAULTS: JobOptions = {
  lyricsMode: 'bilingual',
  exif: false,
  sign: false,
  photoCaption: false,
  dark: false,
  format: 'landscape',
  filter: null,
  filterIntensity: null,
  draft: false,
  trim: 'full',
  speed: 'balanced',
  template: null,
  outroText: DEFAULT_OUTRO_TEXT,
  signatureName: '',
};

const STILL_DEFAULTS: JobOptions = {
  exif: false,
  sign: false,
  photoCaption: false,
  dark: false,
  format: 'landscape',
  filter: null,
  filterIntensity: null,
  scale: 2,
  signatureName: '',
};

/**
 * 滤镜实时预览:取素材夹第一张照片的缩略图,套上与成片同一份 getFilter 输出的
 * CSS/SVG。浏览器与 headless Chromium 渲染 SVG 滤镜存在细微差异,所以只当预览,
 * 不当承诺 —— 提示语放在预览旁边,别让用户拿它去较真像素。
 */
const FilterPreview = ({
  photo,
  filterId,
  intensity,
}: {
  photo: string;
  filterId: string | null;
  intensity: number | null;
}) => {
  const resolved = useMemo(
    () => getFilter(filterId, intensity ?? undefined),
    [filterId, intensity],
  );
  return (
    <div className="filter-preview">
      <div className="filter-preview-frame">
        {resolved.svgDefMarkup && (
          <svg width={0} height={0} style={{position: 'absolute'}} aria-hidden="true">
            <defs dangerouslySetInnerHTML={{__html: resolved.svgDefMarkup}} />
          </svg>
        )}
        <img src={thumbUrl(photo, 240)} alt="" style={resolved.imgStyle} />
        {resolved.overlayStyle && <div className="filter-preview-overlay" style={resolved.overlayStyle} />}
      </div>
      <p className="hint filter-preview-note">预览仅供参考，以成片为准。</p>
    </div>
  );
};

interface OptionsFormProps {
  kind: Kind;
  photos: string[];
  options: JobOptions;
  onChange: (options: JobOptions) => void;
  captionCapability?: Capability;
  hasTranslation: boolean;
}

const OptionsForm = ({kind, photos, options, onChange, captionCapability, hasTranslation}: OptionsFormProps) => {
  const set = <K extends keyof JobOptions>(key: K, value: JobOptions[K]) =>
    onChange({...options, [key]: value});

  // 换滤镜时把强度重置到那个滤镜自己的默认值,免得带着上一个滤镜的强度显得像调坏了
  const handleFilterChange = (filterId: string) => {
    if (filterId === '') {
      onChange({...options, filter: null, filterIntensity: null});
      return;
    }
    const def = FILTERS.find((item) => item.id === filterId);
    onChange({...options, filter: filterId, filterIntensity: def?.defaultIntensity ?? 0.6});
  };
  const format = options.format === 'portrait' ? 'portrait' : 'landscape';

  return (
    <div className="make-form">
      {kind === 'render' && (
        <div className="make-field">
          <span className="make-field-label make-field-label-with-help">
            歌词显示
            {!hasTranslation && <FieldHelp label="了解歌词显示">当前歌词没有中文译文，将显示原文。</FieldHelp>}
          </span>
          <div className="make-radio-group" role="group" aria-label="歌词显示">
            <label className="make-radio">
              <input type="radio" name="lyrics-mode" checked={options.lyricsMode === 'original' || (options.lyricsMode !== 'none' && !hasTranslation)} onChange={() => set('lyricsMode', 'original')} />
              原文
            </label>
            <label className="make-radio">
              <input type="radio" name="lyrics-mode" disabled={!hasTranslation} checked={hasTranslation && options.lyricsMode !== 'original' && options.lyricsMode !== 'none'} onChange={() => set('lyricsMode', 'bilingual')} />
              双语
            </label>
            <label className="make-radio">
              <input type="radio" name="lyrics-mode" checked={options.lyricsMode === 'none'} onChange={() => set('lyricsMode', 'none')} />
              不显示
            </label>
          </div>
          {options.lyricsMode === 'none' ? (
            <p className="make-field-hint">成片不显示歌词，也不会重新下载或识别。</p>
          ) : hasTranslation ? (
            <p className="make-field-hint">原文在上，中文译文在下；切换不会重新下载歌词。</p>
          ) : null}
        </div>
      )}
      <div className="make-field">
        <label className="make-field-label" htmlFor={`${kind}-signature`}>签名</label>
        <input
          id={`${kind}-signature`}
          className="make-text-input"
          value={options.signatureName ?? ''}
          placeholder="输入名字，例如 Bazinga"
          onChange={(event) => {
            const signatureName = event.target.value;
            if (kind === 'still' && signatureName.trim()) onChange({...options, signatureName, sign: true});
            else set('signatureName', signatureName);
          }}
        />
        <p className="make-field-hint">留空沿用现在的。填写后用于这次，汉字用毛笔。</p>
        <SignaturePreview name={options.signatureName ?? ''} />
      </div>
      {kind === 'render' && (
        <div className="make-field">
          <label className="make-field-label" htmlFor={`${kind}-outro`}>片尾文字</label>
          <input
            id={`${kind}-outro`}
            className="make-text-input"
            value={options.outroText ?? DEFAULT_OUTRO_TEXT}
            maxLength={80}
            onChange={(event) => set('outroText', event.target.value)}
          />
          <p className="make-field-hint">出现在片尾白场。留空则不显示。</p>
        </div>
      )}
      <div className="make-checkboxes">
        <label className="make-checkbox">
          <input type="checkbox" checked={options.exif} onChange={(e) => set('exif', e.target.checked)} />
          EXIF 展签
        </label>
        <label className="make-checkbox">
          <input
            type="checkbox"
            checked={options.sign || (kind === 'still' && Boolean(options.signatureName?.trim()))}
            onChange={(e) => {
              if (!e.target.checked && kind === 'still' && options.signatureName?.trim()) {
                onChange({...options, sign: false, signatureName: ''});
                return;
              }
              set('sign', e.target.checked);
            }}
          />
          签名落款
        </label>
        <label className="make-checkbox">
          <input type="checkbox" checked={options.dark} onChange={(e) => set('dark', e.target.checked)} />
          暗色
        </label>
      </div>
      <div className="make-field make-caption-field">
        <div className="make-checkbox-with-help">
          <label className="make-checkbox">
            <input
              type="checkbox"
              checked={options.photoCaption === true}
              disabled={!captionCapability?.enabled && options.photoCaption !== true}
              onChange={(e) => {
                if (e.target.checked && captionCapability && !captionCapability.enabled) return;
                set('photoCaption', e.target.checked);
              }}
            />
            图片旁白
          </label>
          <FieldHelp label="了解图片旁白">为照片补上一句画外之意。开启后会将缩小后的预览发给 DeepSeek，全部生成后再开始制作。原图不会上传。</FieldHelp>
        </div>
        {captionCapability && !captionCapability.enabled && (
          <p className="hint hint-error">{captionCapability.blockers[0]?.reason}</p>
        )}
      </div>

      <div className="make-field">
        <span className="make-field-label">画幅</span>
        <div className="make-radio-group">
          {FORMAT_LABELS.map((item) => (
            <label className="make-radio" key={item.value}>
              <input
                type="radio"
                name={`${kind}-format`}
                checked={format === item.value}
                onChange={() => set('format', item.value)}
              />
              {item.label}
            </label>
          ))}
        </div>
      </div>

      <div className="make-field">
        <span className="make-field-label make-field-label-with-help">滤镜 <FieldHelp label="了解滤镜">这些是接近经典相机与胶片观感的风格效果，并非品牌官方模拟；实际效果会受原片色彩和曝光影响。</FieldHelp></span>
        <FilterPicker value={options.filter} onChange={(filterId) => handleFilterChange(filterId ?? '')} />
        {options.filter && (
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={options.filterIntensity ?? 0.6}
            onChange={(e) => set('filterIntensity', Number(e.target.value))}
            aria-label="滤镜强度"
          />
        )}
      </div>

      {options.filter && photos[0] && (
        <FilterPreview photo={photos[0]} filterId={options.filter} intensity={options.filterIntensity} />
      )}
    </div>
  );
};

interface ActionCardProps {
  kind: Kind;
  capability: Capability;
  folder: string;
  photos: string[];
  onRemedy: (target: Remedy['target']) => void;
  job: ReturnType<typeof useJob>;
  isActive: boolean;
  otherRunning: boolean;
  onStart: (options: JobOptions) => void;
  onReset: () => void;
  captionCapability: Capability;
  hasTranslation?: boolean;
  outroText: string;
}

const ActionCard = ({
  kind,
  capability,
  folder,
  photos,
  onRemedy,
  job,
  isActive,
  otherRunning,
  onStart,
  onReset,
  captionCapability,
  hasTranslation = false,
  outroText,
}: ActionCardProps) => {
  const [expanded, setExpanded] = useState(true);
  const [options, setOptions] = useState<JobOptions>(kind === 'render' ? {...RENDER_DEFAULTS, outroText} : STILL_DEFAULTS);
  const [submittedOptions, setSubmittedOptions] = useState<JobOptions | null>(null);
  const [presets, setPresets] = useState<RenderPreset[]>(() => loadPresets(folder));
  const [presetName, setPresetName] = useState('');
  const optionsPresence = useTransitionPresence(expanded);
  const optionsPanelRef = useRef<HTMLDivElement>(null);
  const lyricsModeKey = lyricsModeStorageKey(folder);
  const outroFolderRef = useRef(folder);

  useEffect(() => {
    setOptions((previous) => constrainOptions(kind, {
      ...previous,
      ...(kind === 'render'
        ? {lyricsMode: previous.lyricsMode === 'original' || previous.lyricsMode === 'none' ? previous.lyricsMode : 'bilingual'}
        : {scale: previous.scale ?? 2}),
    }));
  }, [kind]);

  useEffect(() => {
    const folderChanged = outroFolderRef.current !== folder;
    outroFolderRef.current = folder;
    setOptions((previous) => ({
      ...previous,
      outroText,
      ...(folderChanged ? {signatureName: ''} : {}),
    }));
  }, [folder, outroText]);

  useEffect(() => {
    if (kind !== 'render') return;
    let lyricsMode: 'original' | 'bilingual' | 'none' = 'bilingual';
    try {
      const saved = localStorage.getItem(lyricsModeKey);
      if (saved === 'original' || saved === 'none') lyricsMode = saved;
    } catch {}
    setOptions((previous) => ({...previous, lyricsMode}));
  }, [kind, lyricsModeKey]);

  const handleOptionsChange = (next: JobOptions) => {
    if (kind === 'render' && next.lyricsMode !== options.lyricsMode) {
      try {
        localStorage.setItem(lyricsModeKey, next.lyricsMode === 'original' || next.lyricsMode === 'none' ? next.lyricsMode : 'bilingual');
        window.dispatchEvent(new Event(LYRICS_MODE_EVENT));
      } catch {}
    }
    setOptions(constrainOptions(kind, next));
  };

  const applyPreset = (preset: RenderPreset) => {
    handleOptionsChange({
      ...preset.options,
      photoCaption: preset.options.photoCaption === true,
      lyricsMode: preset.options.lyricsMode === 'original' || preset.options.lyricsMode === 'none' ? preset.options.lyricsMode : 'bilingual',
    });
  };

  const isCurrentPreset = (preset: RenderPreset) => JSON.stringify(preset.options) === JSON.stringify(options);

  const handleSavePreset = () => {
    setPresets(savePreset(folder, presetName, options, []));
    setPresetName('');
  };

  const handleDeletePreset = (id: string) => setPresets(deletePreset(folder, id));

  useEffect(() => {
    if (!isActive || !job.snapshotOptions || submittedOptions) return;
    setSubmittedOptions(job.snapshotOptions);
    setOptions((prev) => constrainOptions(kind, {...prev, ...job.snapshotOptions}));
  }, [isActive, job.snapshotOptions, submittedOptions]);

  useLayoutEffect(() => {
    const panel = optionsPanelRef.current;
    if (!panel) return;
    if (expanded) panel.removeAttribute('inert');
    else panel.setAttribute('inert', '');
  }, [expanded, optionsPresence.present]);

  const showJobPanel = isActive && job.status !== 'idle';
  const adjustLabel = kind === 'render' ? '调整参数再渲染' : '调整参数再导出';
  const handleAdjust = () => {
    // 先保留并展开当前卡片的设置，再收起任务面板；不回填默认值。
    setExpanded(true);
    onReset();
  };
  const command = useMemo(
    () => equivalentCommand(kind, folder, options),
    [kind, folder, options],
  );

  return (
      <div className={capability.enabled ? 'action-card' : 'action-card action-card-blocked'}>
      {capability.enabled ? (
        showJobPanel ? (
          <div className="action-card-content">
            <JobPanel
              verb={KIND_VERB[kind]}
              status={job.status}
              events={job.events}
              error={job.error}
              onCancel={job.cancel}
              onReset={handleAdjust}
              resetLabel={adjustLabel}
              failActions={hasPhotoCaptionFailure(job.status, job.failureStage, job.events) && submittedOptions ? [
                {label: '重试图片旁白', primary: true, onClick: () => onStart(submittedOptions)},
                {label: '不加旁白，继续制作', onClick: () => onStart({...submittedOptions, photoCaption: false})},
              ] : undefined}
            />
          </div>
        ) : (
          <>
            <div className="action-card-content">
              <p className="action-ready">素材齐了，可以开工 ：）</p>
              <button className="make-toggle" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
                <SlidersHorizontal size={13} />
                参数
                <ChevronDown
                  size={13}
                  className={expanded ? 'make-toggle-icon make-toggle-icon-open' : 'make-toggle-icon'}
                />
              </button>
              {optionsPresence.present && (
                <div
                  key={optionsPresence.generation}
                  ref={optionsPanelRef}
                  className={`transition-presence make-form-presence${optionsPresence.visible ? ' transition-presence-open' : ''}`}
                  aria-hidden={!expanded}
                  style={{pointerEvents: expanded ? undefined : 'none'}}
                  onTransitionEnd={optionsPresence.onTransitionEnd}
                >
                  {kind === 'render' && (
                    <div className="make-presets">
                      {presets.length > 0 && (
                        <div className="make-preset-row">
                          {presets.map((preset) => (
                            <div className={`make-preset-chip${isCurrentPreset(preset) ? ' make-preset-chip-active' : ''}`} key={preset.id}>
                              <button
                                type="button"
                                className="make-preset-apply"
                                onClick={() => applyPreset(preset)}
                                title={`应用预设:${preset.name}`}
                              >
                                {preset.name}
                              </button>
                              <button
                                type="button"
                                className="make-preset-delete"
                                onClick={() => handleDeletePreset(preset.id)}
                                aria-label={`删除预设 ${preset.name}`}
                              >
                                ×
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="make-preset-save">
                        <input
                          className="make-preset-name"
                          value={presetName}
                          onChange={(event) => setPresetName(event.target.value)}
                          placeholder="预设名称,如 复古暗夜"
                          aria-label="预设名称"
                        />
                        <button className="link-button" disabled={!presetName.trim()} onClick={handleSavePreset}>存为预设</button>
                      </div>
                    </div>
                  )}
                  <OptionsForm kind={kind} photos={photos} options={options} onChange={handleOptionsChange} captionCapability={captionCapability} hasTranslation={hasTranslation} />
                </div>
              )}
              {otherRunning && <p className="hint">另一项任务正在跑，等它结束再开始。</p>}
            </div>
            <div className="action-card-footer">
              <button className="primary-button" disabled={otherRunning || Boolean(options.photoCaption && !captionCapability.enabled)} onClick={() => { setSubmittedOptions(options); onStart(options); }}>
                开始{KIND_VERB[kind]}
              </button>
              <CommandHint command={command} label="复制命令" />
            </div>
          </>
        )
      ) : (
        <div className="action-card-content">
          <Blocked capability={capability} onRemedy={onRemedy} currentSection="make" />
        </div>
      )}
    </div>
  );
};

interface MakeProps {
  project: ProjectResponse;
  capabilities: Capabilities;
  onRemedy: (target: Remedy['target']) => void;
  /** 由 Workbench 持有，以便切换区段时保留任务与取消入口。 */
  job: ReturnType<typeof useJob>;
  activeKind: Kind | null;
  locked: boolean;
  onStart: (kind: Kind, options: JobOptions) => void;
  onReset: () => void;
}

export const Make = ({project, capabilities, onRemedy, job, activeKind, locked, onStart, onReset}: MakeProps) => {
  const otherRunning = () => locked;
  const [selectedKind, setSelectedKind] = useState<Kind>(() => activeKind ?? 'render');

  useEffect(() => {
    if (activeKind) setSelectedKind(activeKind);
  }, [activeKind]);

  const outputTabs: {kind: Kind; label: string; description: string; icon: ReactNode; capability: Capability}[] = [
    {kind: 'render', label: '渲染相册视频', description: '把照片排成一支影像日记。有歌时会跟着音乐安排画面，没有歌也可以直接做成无声视频。', icon: <Clapperboard size={18} strokeWidth={1.5} />, capability: capabilities.renderVideo},
    {kind: 'still', label: '导出静态图', description: '按成片同款视觉导出单张照片，可带 EXIF 展签，也可以填名字生成签名落款。', icon: <ImageDown size={18} strokeWidth={1.5} />, capability: capabilities.exportStill},
  ];
  const selectedTab = outputTabs.find((tab) => tab.kind === selectedKind) ?? outputTabs[0];

  return (
    <Section title="制作" titleHidden>
      <div className="make-output">
        <div className="make-output-tabs" role="tablist" aria-label="输出方式">
          {outputTabs.map((tab) => (
            <button
              key={tab.kind}
              id={`make-output-tab-${tab.kind}`}
              type="button"
              role="tab"
              aria-selected={selectedKind === tab.kind}
              aria-controls="make-output-panel"
              className={selectedKind === tab.kind ? 'make-output-tab make-output-tab-active' : 'make-output-tab'}
              onClick={() => setSelectedKind(tab.kind)}
            >
              <span className="make-output-tab-title"><span className="make-output-tab-icon">{tab.icon}</span>{tab.label}</span>
              <small>{tab.description}</small>
            </button>
          ))}
        </div>
        <div id="make-output-panel" role="tabpanel" aria-labelledby={`make-output-tab-${selectedTab.kind}`}>
            <ActionCard
              kind={selectedKind}
              capability={selectedKind === 'render' ? capabilities.renderVideo : capabilities.exportStill}
          folder={project.path}
          photos={project.photos}
          onRemedy={onRemedy}
          job={job}
          isActive={activeKind === selectedKind}
          otherRunning={otherRunning()}
          onStart={(options) => onStart(selectedKind, options)}
          onReset={onReset}
          captionCapability={capabilities.photoCaption}
          hasTranslation={selectedKind === 'render' && Boolean(project.lyrics?.some((line) => line.translation?.text))}
          outroText={project.outroText ?? DEFAULT_OUTRO_TEXT}
        />
        </div>
      </div>
    </Section>
  );
};
