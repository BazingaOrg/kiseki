import {useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react';
import type {ReactNode} from 'react';
import {ChevronDown, Clapperboard, ImageDown, SlidersHorizontal} from 'lucide-react';

import {DEFAULT_OUTRO_TEXT} from '../../cli/branding.mjs';
import type {Capability, Capabilities, Remedy} from './capabilities';
import {equivalentCommand} from './command';
import {JobPanel} from './JobPanel';
import {LYRICS_MODE_EVENT, lyricsModeStorageKey, type ProjectResponse} from './types';
import {Blocked, CommandHint, Section} from './ui';
import {FieldHelp} from './FieldHelp';
import {SignaturePreview} from './SignaturePreview';
import type {JobOptions} from './useJob';
import {hasPhotoCaptionFailure, type useJob} from './useJob';
import {useTransitionPresence} from './useTransitionPresence';
import {FilmField} from './FilmField';
import {EMPTY_FILM} from './film-state';

type Kind = 'render' | 'still';

const KIND_VERB: Record<Kind, string> = {render: '渲染', still: '导出'};
const DEFAULT_SIGNATURE_NAME = 'Bazinga';

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

const RENDER_DEFAULTS: JobOptions = {
  lyricsMode: 'bilingual',
  exif: false,
  sign: false,
  photoCaption: false,
  photoCaptionMode: 'existing',
  dark: false,
  format: 'landscape',
  draft: false,
  trim: 'full',
  speed: 'balanced',
  template: null,
  outroText: DEFAULT_OUTRO_TEXT,
  signatureName: DEFAULT_SIGNATURE_NAME,
};

const STILL_DEFAULTS: JobOptions = {
  exif: false,
  sign: false,
  photoCaption: false,
  photoCaptionMode: 'existing',
  dark: false,
  format: 'landscape',
  scale: 2,
  signatureName: DEFAULT_SIGNATURE_NAME,
};

interface OptionsFormProps {
  kind: Kind;
  photos: string[];
  options: JobOptions;
  onChange: (options: JobOptions) => void;
  captionCount: number;
  onManageCaptions: () => void;
  hasTranslation: boolean;
  filmField: ReactNode;
}

const OptionsForm = ({kind, photos, options, onChange, captionCount, onManageCaptions, hasTranslation, filmField}: OptionsFormProps) => {
  const set = <K extends keyof JobOptions>(key: K, value: JobOptions[K]) =>
    onChange({...options, [key]: value});

  const format = options.format === 'portrait' ? 'portrait' : 'landscape';

  return (
    <div className="make-form">
      {filmField}
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
          placeholder="输入签名名字"
          onChange={(event) => {
            const signatureName = event.target.value;
            if (kind === 'still' && signatureName.trim()) onChange({...options, signatureName, sign: true});
            else set('signatureName', signatureName);
          }}
        />
        <p className="make-field-hint">{kind === 'render' ? '片头默认签 Bazinga；可直接改名，汉字会用毛笔字。勾选「签名落款」后也会出现在照片上。' : '默认签 Bazinga；可直接改名，汉字会用毛笔字。'}</p>
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
          <p className="make-field-hint">出现在片尾白场。留空则不显示这句。有音乐时，下面另起一行写歌名和作者。</p>
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
              checked={options.photoCaption === true && captionCount > 0}
              disabled={captionCount === 0}
              onChange={(e) => set('photoCaption', e.target.checked)}
            />
            显示已有图片旁白
          </label>
          <FieldHelp label="了解图片旁白">只在作品中显示已生成的文字，不会在制作时调用 AI。可以先到素材页生成或修改。</FieldHelp>
        </div>
        <p className="make-field-hint">已有 {captionCount}/{photos.length} 张照片的旁白。{captionCount < photos.length && '缺少旁白的照片保持原样。'} <button type="button" className="link-button" onClick={onManageCaptions}>去素材页管理</button></p>
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
    </div>
  );
};

interface ActionCardProps {
  kind: Kind;
  capability: Capability;
  folder: string;
  photos: string[];
  onRemedy: (target: Remedy['target']) => void;
  onManageCaptions: () => void;
  job: ReturnType<typeof useJob>;
  isActive: boolean;
  otherRunning: boolean;
  onStart: (options: JobOptions) => void;
  onReset: () => void;
  captionCount: number;
  hasTranslation?: boolean;
  outroText: string;
  filmField: ReactNode;
}

const ActionCard = ({
  kind,
  capability,
  folder,
  photos,
  onRemedy,
  onManageCaptions,
  job,
  isActive,
  otherRunning,
  onStart,
  onReset,
  captionCount,
  hasTranslation = false,
  outroText,
  filmField,
}: ActionCardProps) => {
  const [expanded, setExpanded] = useState(true);
  const [options, setOptions] = useState<JobOptions>(kind === 'render' ? {...RENDER_DEFAULTS, outroText} : STILL_DEFAULTS);
  const [submittedOptions, setSubmittedOptions] = useState<JobOptions | null>(null);
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
      ...(folderChanged ? {signatureName: DEFAULT_SIGNATURE_NAME} : {}),
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

  useEffect(() => {
    if (captionCount === 0) setOptions((previous) => previous.photoCaption ? {...previous, photoCaption: false} : previous);
  }, [captionCount]);

  const handleOptionsChange = (next: JobOptions) => {
    if (kind === 'render' && next.lyricsMode !== options.lyricsMode) {
      try {
        localStorage.setItem(lyricsModeKey, next.lyricsMode === 'original' || next.lyricsMode === 'none' ? next.lyricsMode : 'bilingual');
        window.dispatchEvent(new Event(LYRICS_MODE_EVENT));
      } catch {}
    }
    setOptions(constrainOptions(kind, next));
  };

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
                  <OptionsForm kind={kind} photos={photos} options={options} onChange={handleOptionsChange} captionCount={captionCount} onManageCaptions={onManageCaptions} hasTranslation={hasTranslation} filmField={filmField} />
                </div>
              )}
              {otherRunning && <p className="hint">另一项任务正在跑，等它结束再开始。</p>}
            </div>
            <div className="action-card-footer">
              <button className="primary-button" disabled={otherRunning} onClick={() => { setSubmittedOptions(options); onStart(options); }}>
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
  onManageCaptions: () => void;
  /** 由 Workbench 持有，以便切换区段时保留任务与取消入口。 */
  job: ReturnType<typeof useJob>;
  activeKind: Kind | null;
  locked: boolean;
  onStart: (kind: Kind, options: JobOptions) => void;
  onReset: () => void;
}

export const Make = ({project, capabilities, onRemedy, onManageCaptions, job, activeKind, locked, onStart, onReset}: MakeProps) => {
  const captionCount = project.assets?.photos.items.filter((item) => Boolean(item.caption)).length ?? 0;
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
  const filmField = <FilmField folder={project.path} photos={project.assets?.photos.items ?? []} initial={project.film ?? EMPTY_FILM} locked={locked} />;

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
          onManageCaptions={onManageCaptions}
          job={job}
          isActive={activeKind === selectedKind}
          otherRunning={otherRunning()}
          onStart={(options) => onStart(selectedKind, options)}
          onReset={onReset}
          captionCount={captionCount}
          hasTranslation={selectedKind === 'render' && Boolean(project.lyrics?.some((line) => line.translation?.text))}
          outroText={project.outroText ?? DEFAULT_OUTRO_TEXT}
          filmField={filmField}
        />
        </div>
      </div>
    </Section>
  );
};
