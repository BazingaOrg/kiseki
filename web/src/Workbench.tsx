import {useCallback, useEffect, useRef, useState} from 'react';
import {FolderOpen} from 'lucide-react';

import {deriveCapabilities} from './capabilities';
import type {Remedy} from './capabilities';
import {DoctorPanel} from './DoctorPanel';
import {Logo} from './Logo';
import {Make} from './Make';
import {Materials} from './Materials';
import {Results} from './Results';
import type {DoctorState, ProjectResponse, ProjectSelection} from './types';
import {CommandHint} from './ui';
import {Dialog} from './Dialog';
import type {JobKind, JobRequest} from './useJob';
import {useJob} from './useJob';
import {clearLastJobRecord, readLastJobRecord} from './lastJob';
import {clearRecognizedLyrics, mutateAsset, undoAssetDelete} from './api';
import type {AssetItem} from './types';

type SectionKey = 'materials' | 'make' | 'results';
type JobLock = 'checking' | 'free' | 'owned' | 'busy' | 'unknown';

const isCurrentJob = (value: unknown): value is {id: string; kind: JobKind; folder: string} =>
  value !== null &&
  typeof value === 'object' &&
  'id' in value && typeof value.id === 'string' &&
  'kind' in value && typeof value.kind === 'string' &&
  'folder' in value && typeof value.folder === 'string' &&
  ['render', 'still', 'fetch-audio', 'lyrics'].includes(value.kind);

const SECTIONS: {key: SectionKey; label: string}[] = [
  {key: 'materials', label: '素材'},
  {key: 'make', label: '制作'},
  {key: 'results', label: '成果'},
];

/** 旧项目优先回到已有成片或静态作品，没有成果时才停在素材步骤。 */
const initialSection = (project: ProjectResponse): SectionKey =>
  project.output.videos.length > 0 || project.output.stills.length > 0 ? 'results' : 'materials';

interface WorkbenchProps {
  project: ProjectResponse;
  projectSelection: ProjectSelection;
  doctor: DoctorState;
  onRecheckDoctor: () => void;
  onSwitchFolder: () => void;
  /** 任务跑完后重新拉一次素材夹状态,「制作」把它转交给起任务的地方在结束时调用 */
  onProjectRefresh: () => void;
  /** 最近一次 onProjectRefresh 失败了,当前看到的可能不是最新数据 */
  projectStale: boolean;
}

export const Workbench = ({
  project,
  projectSelection,
  doctor,
  onRecheckDoctor,
  onSwitchFolder,
  onProjectRefresh,
  projectStale,
}: WorkbenchProps) => {
  const [section, setSection] = useState<SectionKey>(() => initialSection(project));
  const [doctorOpen, setDoctorOpen] = useState(false);
  const capabilities = deriveCapabilities(project, doctor);
  const locked = projectSelection === 'sandbox' && project.root === project.path;
  // 导出静态图不需要音频，只要 renderVideo 或 exportStill 任一可用就该放行「制作」
  const makeUnlocked = capabilities.renderVideo.enabled || capabilities.exportStill.enabled;
  const resultsUnlocked = project.output.videos.length > 0 || project.output.stills.length > 0;
  const sectionUnlocked = (key: SectionKey) =>
    key === 'materials' || (key === 'make' ? makeUnlocked : resultsUnlocked);

  // 刷新后素材或最后一份成片可能消失，不能继续停在已经锁定的步骤。
  useEffect(() => {
    const currentLocked =
      (section === 'make' && !makeUnlocked) || (section === 'results' && !resultsUnlocked);
    if (currentLocked) setSection(makeUnlocked ? 'make' : 'materials');
  }, [section, makeUnlocked, resultsUnlocked]);

  // 任务状态必须覆盖可切换区段，但不能跨素材夹实例。
  const probeRef = useRef<() => void>(() => {});
  const probeGenerationRef = useRef(0);
  const probeAbortRef = useRef<AbortController | null>(null);
  const projectPathRef = useRef(project.path);
  projectPathRef.current = project.path;
  const handleDisconnect = useCallback(() => probeRef.current(), []);
  const job = useJob(onProjectRefresh, handleDisconnect);
  const {reconnect, release, resetDisplay} = job;
  const [activeKind, setActiveKind] = useState<JobKind | null>(null);
  const [jobLock, setJobLock] = useState<JobLock>('checking');
  const jobBusy = jobLock !== 'free' || job.busy;
  const [restartNotice, setRestartNotice] = useState<string | null>(null);

  const jobKindLabel = (kind: string) =>
    ({render: '渲染', still: '导出静态图', 'fetch-audio': '获取音频', lyrics: '识别歌词'})[kind] ?? kind;

  const invalidateProbe = useCallback(() => {
    ++probeGenerationRef.current;
    probeAbortRef.current?.abort();
    probeAbortRef.current = null;
  }, []);

  const probeCurrentJob = useCallback(() => {
    invalidateProbe();
    const generation = probeGenerationRef.current;
    const projectPath = project.path;
    const controller = new AbortController();
    probeAbortRef.current = controller;
    setJobLock('checking');
    const isCurrent = () =>
      generation === probeGenerationRef.current &&
      projectPathRef.current === projectPath &&
      !controller.signal.aborted;

    fetch('/api/jobs/current', {signal: controller.signal})
      .then((res) => {
        if (!res.ok) throw new Error('current-job-unavailable');
        return res.json() as Promise<unknown>;
      })
      .then((payload) => {
        if (!isCurrent()) return;
        // 只有服务端明确表示没有任务时才能解锁；失败或未知形状一律维持锁定。
        if (!payload || typeof payload !== 'object' || !('job' in payload)) {
          setJobLock('unknown');
          return;
        }
        const runningJob = payload.job;
        if (runningJob === null) {
          // 释放写锁但保留终态面板；残留任务记录仅用于识别服务重启。
          const lastJob = readLastJobRecord();
          if (lastJob) {
            clearLastJobRecord();
            fetch(`/api/jobs/${encodeURIComponent(lastJob.id)}`)
              .then((res) => {
                if (isCurrent() && res.status === 404) {
                  setRestartNotice(`服务已重启,之前${jobKindLabel(lastJob.kind)}的任务已终止,需要重新开始。`);
                }
              })
              .catch(() => undefined);
          }
          release();
          setJobLock('free');
          return;
        }
        if (!isCurrentJob(runningJob)) {
          setJobLock('unknown');
          return;
        }
        if (runningJob.folder !== project.path) {
          setJobLock('busy');
          return;
        }
        setActiveKind(runningJob.kind);
        reconnect(runningJob.id);
        setJobLock('owned');
      })
      .catch(() => {
        if (isCurrent()) setJobLock('unknown');
      });
  }, [invalidateProbe, project.path, reconnect, release]);

  probeRef.current = probeCurrentJob;

  // 挂载时重新接管属于当前素材夹的服务端任务。
  useEffect(() => {
    probeCurrentJob();
    // 不能只清理这一次 probe：SSE 断开或任务终态可能在之后发起更新的 probe，
    // 卸载时必须一并作废当前 generation 并中止它。
    return invalidateProbe;
  }, [invalidateProbe, probeCurrentJob]);

  // 收到 SSE end 后也重新确认服务端状态；不能仅凭前端结束事件放开写入口。
  useEffect(() => {
    if (jobLock === 'owned' && !job.busy) probeCurrentJob();
  }, [job.busy, jobLock, probeCurrentJob]);
  const [assetBusy, setAssetBusy] = useState(false);
  const [dialog, setDialog] = useState<{title: string; message: string; confirm?: () => Promise<void>; destructive?: boolean; confirmLabel?: string} | null>(null);

  const handleStart = async (request: JobRequest): Promise<boolean> => {
    if (jobBusy) return false;
    // 请求在途也必须锁住，直到服务端明确接受或 current 明确为空。
    invalidateProbe();
    // POST 尚未返回 id 时也要把面板归属到发起卡片，取消会被 useJob 记下并在
    // id 到手后补发，不能让用户在这个窗口失去取消入口。
    setActiveKind(request.kind);
    setJobLock('checking');
    try {
      const accepted = await job.start({...request, folder: project.path});
      if (accepted) {
        setJobLock('owned');
        return true;
      }
    } catch {
      // 保持 fail-closed，由 current probe 决定是否释放写锁。
    }
    // 失败或未被接受时仍然 fail-closed，只有最新一次 current probe 明确为 null
    // 才会解锁；不要清空 pending kind 或旧终态展示。
    probeCurrentJob();
    return false;
  };

  const resetJobDisplay = () => {
    resetDisplay();
    setActiveKind(null);
  };

  const handleRemedy = (target: Remedy['target']) => {
    if (target === 'doctor') setDoctorOpen(true);
    else if (sectionUnlocked(target)) setSection(target);
  };
  const performAsset = async (item: AssetItem, action: 'rename' | 'delete', stem?: string): Promise<boolean> => {
    if (assetBusy || jobBusy) return false;
    setAssetBusy(true);
    const result = await mutateAsset(project.path, item.id, action, stem);
    setAssetBusy(false);
    if (!result.ok) {
      if (result.recoveryUndoId) {
        setDialog({title: '需要恢复未完成的操作', message: result.message, confirmLabel: '尝试恢复', confirm: async () => { if (await handleRecovery(result.recoveryUndoId!)) setDialog(null); }});
      } else setDialog({title: '操作未完成', message: result.message});
      return false;
    }
    onProjectRefresh();
    return true;
  };
  const handleAsset = (item: AssetItem, action: 'rename' | 'delete', stem?: string) => {
    if (action === 'delete') {
      setDialog({
        title: '删除这个文件？',
        message: `“${item.name}”将被永久删除，此操作无法恢复。`,
        destructive: true,
        confirm: async () => {
          if (await performAsset(item, action, stem)) setDialog(null);
        },
      });
      return;
    }
    void performAsset(item, action, stem);
  };
  const handleRecovery = async (undoId: string): Promise<boolean> => {
    if (assetBusy || jobBusy) return false;
    setAssetBusy(true);
    const result = await undoAssetDelete(project.path, undoId);
    setAssetBusy(false);
    if (!result.ok) {
      const recoveryUndoId = result.recoveryUndoId ?? undoId;
      if (result.recoveryRequired || result.recoveryUndoId) {
        setDialog({title: '恢复未完成', message: result.message, confirmLabel: '再次尝试恢复', confirm: async () => { if (await handleRecovery(recoveryUndoId)) setDialog(null); }});
      } else setDialog({title: '恢复未完成', message: result.message});
      return false;
    }
    onProjectRefresh();
    return true;
  };
  const performClearRecognizedLyrics = async (): Promise<boolean> => {
    if (assetBusy || jobBusy) return false;
    setAssetBusy(true);
    const result = await clearRecognizedLyrics(project.path);
    setAssetBusy(false);
    if (!result.ok) {
      if (result.recoveryUndoId) {
        setDialog({title: '需要恢复未完成的操作', message: result.message, confirmLabel: '尝试恢复', confirm: async () => { if (await handleRecovery(result.recoveryUndoId!)) setDialog(null); }});
      } else setDialog({title: '操作未完成', message: result.message});
      return false;
    }
    onProjectRefresh();
    return true;
  };
  const handleClearRecognizedLyrics = () => {
    setDialog({
      title: '清除识别结果？',
      message: '会移除本地识别歌词及依赖的时间线；不会删除 .lrc、分析缓存或节拍。',
      destructive: true,
      confirmLabel: '清除',
      confirm: async () => { if (await performClearRecognizedLyrics()) setDialog(null); },
    });
  };
  const handleReplaceRecognizedLyrics = () => {
    if (assetBusy || jobBusy) return;
    setDialog({
      title: '重新识别歌词？',
      message: '会以新的本地识别结果替换当前识别歌词；识别失败时保留当前结果。成功后会清除依赖的时间线，不会删除 .lrc、分析缓存或节拍。',
      confirmLabel: '重新识别',
      confirm: async () => {
        if (await handleStart({kind: 'lyrics', options: {replace: true}})) setDialog(null);
      },
    });
  };

  return (
    <div className="workbench">
      <header className="topbar">
        <Logo />
        <nav className="section-nav" aria-label="工作流程">
          {SECTIONS.map((item) => (
            <button
              key={item.key}
              className={[
                'section-tab',
                section === item.key ? 'section-tab-active' : '',
                sectionUnlocked(item.key) ? '' : 'section-tab-locked',
              ].filter(Boolean).join(' ')}
              onClick={() => sectionUnlocked(item.key) && setSection(item.key)}
              disabled={!sectionUnlocked(item.key)}
              aria-current={section === item.key ? 'step' : undefined}
            >
              <span className="section-step">{SECTIONS.indexOf(item) + 1}</span>
              {item.label}
            </button>
          ))}
        </nav>
        <div className="topbar-actions">
          {/*
            启动时锁定了素材夹的话(kiseki web <folder>),沙箱根就是这个素材夹,
            选择器里除了它自己什么都挑不到。那就不该摆一个点了只能选回原地的按钮 ——
            换成一个说明,并告诉用户换一种启动方式就能挑别的。
          */}
          {locked ? (
            <span className="folder-switch folder-switch-locked" title={`${project.path}\n启动时已锁定这个素材夹`}>
              <FolderOpen size={15} strokeWidth={1.5} />
              <span className="folder-switch-name">{project.path}</span>
            </span>
          ) : (
            <button
              className="folder-switch"
              onClick={onSwitchFolder}
              title={project.path}
              disabled={jobBusy}
              aria-describedby={jobBusy ? 'folder-switch-busy' : undefined}
            >
              <FolderOpen size={15} strokeWidth={1.5} />
              <span className="folder-switch-name">{project.path}</span>
            </button>
          )}
          <DoctorPanel
            doctor={doctor}
            open={doctorOpen}
            onToggle={() => setDoctorOpen((v) => !v)}
            onRecheck={onRecheckDoctor}
          />
        </div>
      </header>

      <div className="workbench-content">
        {/* 光把切换按钮禁掉不够 —— 得说清为什么换不了、以及怎么才能换 */}
        {locked && (
          <p className="locked-note">
            启动时锁定了这个素材夹，页面里换不了。想挑别的，改用不带参数的启动方式：
            <CommandHint command="kiseki web" />
          </p>
        )}
        {!locked && jobBusy && (
          <p className="locked-note" id="folder-switch-busy">
            {jobLock === 'checking' || jobLock === 'unknown' ? '正在确认后台任务，这期间不能改动素材夹。' : '任务还在跑，这期间换不了素材夹 —— 换了进度和取消入口都会消失，任务却还在后台继续。'}
            <button className="link-button" onClick={() => setSection(activeKind ? 'make' : 'materials')}>回到任务</button>
          </p>
        )}
        {projectStale && (
          <p className="locked-note hint-error" role="status">
            素材夹状态没刷新成功，现在看到的可能不是最新的。
            <button className="link-button" onClick={onProjectRefresh}>重试</button>
          </p>
        )}
        {restartNotice && (
          <p className="locked-note hint-error" role="status">
            {restartNotice}
            <button className="link-button" onClick={() => setRestartNotice(null)}>知道了</button>
          </p>
        )}

        <main className="workbench-main">
          {section === 'materials' && (
            <Materials
              project={project}
              capabilities={capabilities}
              onRemedy={handleRemedy}
              job={job}
              activeKind={activeKind === 'fetch-audio' || activeKind === 'lyrics' ? activeKind : null}
              onStart={handleStart}
              onReset={resetJobDisplay}
              onRefresh={onProjectRefresh}
              onReplaceRecognizedLyrics={handleReplaceRecognizedLyrics}
              onClearRecognizedLyrics={handleClearRecognizedLyrics}
              locked={jobBusy}
              assetBusy={assetBusy || jobBusy}
              onAsset={handleAsset}
            />
          )}
          {section === 'make' && (
            <Make
              project={project}
              capabilities={capabilities}
              onRemedy={handleRemedy}
              job={job}
              activeKind={activeKind === 'render' || activeKind === 'still' ? activeKind : null}
              onStart={(kind, options) => handleStart({kind, options})}
              onReset={resetJobDisplay}
              locked={jobBusy}
            />
          )}
          {section === 'results' && (
            <Results project={project} capabilities={capabilities} onRemedy={handleRemedy} assetBusy={assetBusy || jobBusy} onAsset={handleAsset} />
          )}
        </main>
      </div>
      {dialog && <Dialog key={`${dialog.title}:${dialog.message}`} title={dialog.title} message={dialog.message} destructive={dialog.destructive} confirmLabel={dialog.confirm ? (dialog.confirmLabel ?? '删除') : '知道了'} onConfirm={dialog.confirm} onClose={() => setDialog(null)} />}
    </div>
  );
};
