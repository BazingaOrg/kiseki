/**
 * 「制作」区段:选参数、起任务、看进度、随时取消。
 *
 * 门禁(能不能点)完全交给 capabilities,这里只管点了之后的事。本地单人工具,
 * 服务端同一时刻只跑一个任务(见批 B 契约二),所以两张卡共享同一个 useJob 实例:
 * activeKind 记着进度面板当前属于哪张卡,另一张卡在此期间只把开始按钮禁掉、
 * 说明原因 —— 沿用 Blocked 组件"禁用必须带理由"的规矩,这里理由是任务占用而非
 * 素材缺失,所以没有直接套 Blocked,而是单独一行提示。
 */
import {useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react';
import type {ReactNode} from 'react';
import {ChevronDown, Clapperboard, ImageDown, SlidersHorizontal} from 'lucide-react';

// 直接复用渲染管线的滤镜/模板定义:预览与成片同源,不再养第三份副本
import {FILTERS, getFilter} from '../../renderer/src/filters';
import {TEMPLATES as RENDER_TEMPLATES, type Template} from '../../renderer/src/templates';
import type {Capability, Capabilities, Remedy} from './capabilities';
import {equivalentCommand} from './command';
import {JobPanel} from './JobPanel';
import {thumbUrl} from './media';
import {deletePreset, loadPresets, savePreset, type RenderPreset} from './presets';
import type {ProjectResponse} from './types';
import {Blocked, CommandHint, Section} from './ui';
import type {JobOptions} from './useJob';
import type {useJob} from './useJob';
import {useTransitionPresence} from './useTransitionPresence';

type Kind = 'render' | 'still';

/** 模板卡片示意:按 1080p 基准缩放字号,让卡片里的样本字幕接近成片的相对观感 */
const CARD_CAPTION_SCALE = 0.34;
const SAMPLE_CAPTION = '晴天 海边 午后';

const captionCardStyle = (template: Template | undefined) => ({
  fontSize: `${(template?.captions?.fontSize ?? 36) * CARD_CAPTION_SCALE}px`,
  fontWeight: template?.captions?.fontWeight ?? 500,
  letterSpacing: template?.captions?.letterSpacing ?? '0.12em',
  ...(template?.fontFamily === 'sans' ? {fontFamily: 'var(--font-sans)'} : {}),
});

const chapterCardStyle = (template: Template | undefined) => ({
  fontSize: `${(template?.chapterCard?.fontSize ?? 46) * CARD_CAPTION_SCALE}px`,
  letterSpacing: template?.chapterCard?.letterSpacing ?? '0.1em',
});

const KIND_VERB: Record<Kind, string> = {render: '渲染', still: '导出'};

const FORMAT_LABELS: {value: JobOptions['format']; label: string}[] = [
  {value: 'landscape', label: '横版'},
  {value: 'portrait', label: '竖版'},
  {value: 'square', label: '方形'},
];

// null = 交给默认逻辑;auto/full 对应 CLI 交互里"接受裁剪"/"播完整首歌"两个选项(见 cli/trim.mjs)
const TRIM_LABELS: {value: JobOptions['trim']; label: string}[] = [
  {value: null, label: '默认'},
  {value: 'auto', label: '截到重拍处'},
  {value: 'full', label: '播完整首歌'},
];

// 并发档位。默认 balanced = CLI 的默认(一半核心) —— 渲染时你多半还在用这台机器
const SPEED_LABELS: {value: NonNullable<JobOptions['speed']>; label: string; hint: string}[] = [
  {value: 'saver', label: '省着点', hint: '约四分之一核心，边渲染边干别的'},
  {value: 'balanced', label: '均衡', hint: '约一半核心'},
  {value: 'full', label: '快', hint: '几乎占满，风扇会转起来'},
];

const RENDER_DEFAULTS: JobOptions = {
  exif: false,
  sign: false,
  dark: false,
  format: 'landscape',
  filter: null,
  filterIntensity: null,
  draft: false,
  trim: null,
  speed: 'balanced',
  template: null,
};

const STILL_DEFAULTS: JobOptions = {
  exif: false,
  sign: false,
  dark: false,
  format: 'landscape',
  filter: null,
  filterIntensity: null,
  scale: 2,
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
}

const OptionsForm = ({kind, photos, options, onChange}: OptionsFormProps) => {
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

  return (
    <div className="make-form">
      {/* 呈现层模板:只影响转场/字幕/章节卡的"长相",滤镜/暗色等素材基调选项保持独立。
          卡片示意用注册表的真实样式值拼 CSS 预览,与滤镜预览同模式,标注示意不当承诺。 */}
      {kind === 'render' && (
        <div className="make-field">
          <span className="make-field-label">呈现模板</span>
          <div className="make-radio-group make-template-grid">
            <label className="make-radio make-template-card">
              <input type="radio" name="render-template" checked={!options.template} onChange={() => set('template', null)} />
              {photos[0] && (
                <span className="make-template-card-visual">
                  <img src={thumbUrl(photos[0], 240)} alt="" loading="lazy" />
                  <span className="make-template-card-caption" style={captionCardStyle(undefined)}>{SAMPLE_CAPTION}</span>
                </span>
              )}
              <span className="make-template-card-body">
                <strong>默认</strong>
                <em>跟随配置的转场与字幕</em>
              </span>
            </label>
            {RENDER_TEMPLATES.map((template) => (
              <label className="make-radio make-template-card" key={template.id}>
                <input type="radio" name="render-template" checked={options.template === template.id} onChange={() => set('template', template.id)} />
                {photos[0] && (
                  <span className="make-template-card-visual">
                    <img src={thumbUrl(photos[0], 240)} alt="" loading="lazy" />
                    {template.chapterCard && (
                      <span className="make-template-card-chapter" style={chapterCardStyle(template)}>第一天</span>
                    )}
                    <span className="make-template-card-caption" style={captionCardStyle(template)}>{SAMPLE_CAPTION}</span>
                  </span>
                )}
                <span className="make-template-card-body">
                  <strong>{template.name}</strong>
                  <em>{template.description}</em>
                </span>
              </label>
            ))}
          </div>
          <p className="make-field-hint">卡片为样式示意,以成片为准。</p>
        </div>
      )}

      <div className="make-checkboxes">
        <label className="make-checkbox">
          <input type="checkbox" checked={options.exif} onChange={(e) => set('exif', e.target.checked)} />
          EXIF 展签
        </label>
        <label className="make-checkbox">
          <input type="checkbox" checked={options.sign} onChange={(e) => set('sign', e.target.checked)} />
          签名落款
        </label>
        <label className="make-checkbox">
          <input type="checkbox" checked={options.dark} onChange={(e) => set('dark', e.target.checked)} />
          暗色
        </label>
        {kind === 'render' && (
          <label className="make-checkbox">
            <input
              type="checkbox"
              checked={options.draft ?? false}
              onChange={(e) => set('draft', e.target.checked)}
            />
            草稿模式（渲染更快，预览画质较低）
          </label>
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
                checked={options.format === item.value}
                onChange={() => set('format', item.value)}
              />
              {item.label}
            </label>
          ))}
        </div>
      </div>

      {kind === 'render' && (
        <div className="make-field">
          <span className="make-field-label">时长裁剪</span>
          <div className="make-radio-group">
            {TRIM_LABELS.map((item) => (
              <label className="make-radio" key={item.label}>
                <input
                  type="radio"
                  name="render-trim"
                  checked={options.trim === item.value}
                  onChange={() => set('trim', item.value)}
                />
                {item.label}
              </label>
            ))}
          </div>
        </div>
      )}

      {/* 只给渲染:still 不走 resolveRenderSettings,并发对它无效,摆在那只会误导 */}
      {kind === 'render' && (
        <div className="make-field">
          <span className="make-field-label">渲染速度</span>
          <div className="make-radio-group">
            {SPEED_LABELS.map((item) => (
              <label className="make-radio" key={item.value} title={item.hint}>
                <input
                  type="radio"
                  name="render-speed"
                  checked={(options.speed ?? 'balanced') === item.value}
                  onChange={() => set('speed', item.value)}
                />
                {item.label}
              </label>
            ))}
          </div>
          <p className="make-field-hint">
            {SPEED_LABELS.find((item) => item.value === (options.speed ?? 'balanced'))?.hint}
          </p>
        </div>
      )}

      {kind === 'still' && (
        <div className="make-field">
          <span className="make-field-label">输出倍率 ×{options.scale ?? 2}</span>
          <input
            type="range"
            min={1}
            max={4}
            step={1}
            value={options.scale ?? 2}
            onChange={(e) => set('scale', Number(e.target.value))}
          />
          <p className="make-field-hint">仅影响单张导出；实际像素为项目画布 × 当前倍率。</p>
        </div>
      )}

      <div className="make-field">
        <span className="make-field-label">滤镜</span>
        <select
          className="make-select"
          value={options.filter ?? ''}
          onChange={(e) => handleFilterChange(e.target.value)}
        >
          <option value="">无</option>
          {FILTERS.map((filter) => (
            <option key={filter.id} value={filter.id}>
              {filter.label}
            </option>
          ))}
        </select>
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
  icon: ReactNode;
  title: string;
  description: string;
  capability: Capability;
  folder: string;
  photos: string[];
  onRemedy: (target: Remedy['target']) => void;
  job: ReturnType<typeof useJob>;
  isActive: boolean;
  otherRunning: boolean;
  onStart: (options: JobOptions) => void;
  onReset: () => void;
}

const ActionCard = ({
  kind,
  icon,
  title,
  description,
  capability,
  folder,
  photos,
  onRemedy,
  job,
  isActive,
  otherRunning,
  onStart,
  onReset,
}: ActionCardProps) => {
  const [expanded, setExpanded] = useState(false);
  const [options, setOptions] = useState<JobOptions>(kind === 'render' ? RENDER_DEFAULTS : STILL_DEFAULTS);
  const [presets, setPresets] = useState<RenderPreset[]>(() => loadPresets(folder));
  const [presetName, setPresetName] = useState('');
  const optionsPresence = useTransitionPresence(expanded);
  const optionsPanelRef = useRef<HTMLDivElement>(null);
  // 呈现模板按素材夹记忆:同一种风格反复迭代时不用每次重选
  const templateStorageKey = `tsuzuri-template:${folder}`;

  useEffect(() => {
    // 挂载后回填上次选择的模板;只在用户尚未手动选过时生效
    if (kind !== 'render' || options.template) return;
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(templateStorageKey);
    } catch {}
    if (saved && RENDER_TEMPLATES.some((t) => t.id === saved)) {
      setOptions((prev) => ({...prev, template: saved}));
    }
  }, [kind, options.template, templateStorageKey]);

  const handleOptionsChange = (next: JobOptions) => {
    if (kind === 'render' && next.template !== options.template) {
      try {
        if (next.template) localStorage.setItem(templateStorageKey, next.template);
        else localStorage.removeItem(templateStorageKey);
      } catch {}
    }
    setOptions(next);
  };

  // 预设 = 用户级一键组合(模板+滤镜+暗色+开关),应用时净化可能已失效的模板 id
  const applyPreset = (preset: RenderPreset) => {
    const template = preset.options.template && RENDER_TEMPLATES.some((t) => t.id === preset.options.template)
      ? preset.options.template
      : null;
    handleOptionsChange({...preset.options, template});
  };

  const isCurrentPreset = (preset: RenderPreset) => JSON.stringify(preset.options) === JSON.stringify(options);

  const handleSavePreset = () => {
    setPresets(savePreset(folder, presetName, options, RENDER_TEMPLATES.map((t) => t.id)));
    setPresetName('');
  };

  const handleDeletePreset = (id: string) => setPresets(deletePreset(folder, id));

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
      <div className="action-head">
        <span className="action-icon">{icon}</span>
        <h3 className="action-title">{title}</h3>
      </div>
      <p className="action-description">{description}</p>

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
            />
          </div>
        ) : (
          <>
            <div className="action-card-content">
              <p className="action-ready">素材齐了，可以开工。</p>
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
                  <OptionsForm kind={kind} photos={photos} options={options} onChange={handleOptionsChange} />
                </div>
              )}
              {otherRunning && <p className="hint">另一项任务正在跑，等它结束再开始。</p>}
            </div>
            <div className="action-card-footer">
              <button className="primary-button" disabled={otherRunning} onClick={() => onStart(options)}>
                开始{KIND_VERB[kind]}
              </button>
              <CommandHint command={command} />
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
  /**
   * 任务状态由 Workbench 持有,不在这里 useJob —— 切到别的区段时 Make 会被卸载,
   * hook 的 cleanup 会关掉 EventSource 并丢掉 jobId。用户渲染途中切去看一眼成果
   * 再切回来,界面就会退回"可以开工",点了拿 409,而且再没有入口能取消那个任务。
   */
  job: ReturnType<typeof useJob>;
  activeKind: Kind | null;
  locked: boolean;
  onStart: (kind: Kind, options: JobOptions) => void;
  /** 收起已结束的进度面板,回到参数表单 */
  onReset: () => void;
}

export const Make = ({project, capabilities, onRemedy, job, activeKind, locked, onStart, onReset}: MakeProps) => {
  const otherRunning = () => locked;

  return (
    <Section title="制作" titleHidden>
      <div className="action-cards">
        <ActionCard
          kind="render"
          icon={<Clapperboard size={20} strokeWidth={1.5} />}
          title="渲染相册视频"
          description="分析音乐的节拍，把照片排进时间线，渲染成一支踩点影像日记。"
          capability={capabilities.renderVideo}
          folder={project.path}
          photos={project.photos}
          onRemedy={onRemedy}
          job={job}
          isActive={activeKind === 'render'}
          otherRunning={otherRunning()}
          onStart={(options) => onStart('render', options)}
          onReset={onReset}
        />
        <ActionCard
          kind="still"
          icon={<ImageDown size={20} strokeWidth={1.5} />}
          title="导出静态图"
          description="按成片同款视觉导出单张照片，可带 EXIF 展签与签名落款。"
          capability={capabilities.exportStill}
          folder={project.path}
          photos={project.photos}
          onRemedy={onRemedy}
          job={job}
          isActive={activeKind === 'still'}
          otherRunning={otherRunning()}
          onStart={(options) => onStart('still', options)}
          onReset={onReset}
        />
      </div>
    </Section>
  );
};
