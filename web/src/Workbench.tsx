/**
 * 选定素材夹之后的工作台:顶栏 + 素材 / 制作 / 成果 三段。
 *
 * 三段按「素材 → 制作 → 成果」受控前进；历史成片始终可以回看。
 */
import {useEffect, useState} from 'react';
import {FolderOpen} from 'lucide-react';

import {deriveCapabilities} from './capabilities';
import type {Remedy} from './capabilities';
import {DoctorPanel} from './DoctorPanel';
import {Logo} from './Logo';
import {Make} from './Make';
import {Materials} from './Materials';
import {Results} from './Results';
import type {DoctorState, ProjectResponse} from './types';
import {CommandHint} from './ui';
import {Dialog} from './Dialog';
import type {JobKind, JobRequest} from './useJob';
import {useJob} from './useJob';
import {mutateAsset, undoAssetDelete} from './api';
import type {AssetItem} from './types';

type SectionKey = 'materials' | 'make' | 'results';

const SECTIONS: {key: SectionKey; label: string}[] = [
  {key: 'materials', label: '素材'},
  {key: 'make', label: '制作'},
  {key: 'results', label: '成果'},
];

/** 旧项目优先回到已有成片或静态作品，没有成果时才停在素材步骤。 */
const initialSection = (project: ProjectResponse): SectionKey =>
  project.output.videos.length > 0 || project.output.stills.length > 0 ? 'results' : 'materials';

const middleTruncate = (value: string, maxLength = 36) => {
  if (value.length <= maxLength) return value;
  const edge = Math.floor((maxLength - 1) / 2);
  return `${value.slice(0, edge)}…${value.slice(-edge)}`;
};

interface WorkbenchProps {
  project: ProjectResponse;
  doctor: DoctorState;
  onRecheckDoctor: () => void;
  onSwitchFolder: () => void;
  /** 任务跑完后重新拉一次素材夹状态,「制作」把它转交给起任务的地方在结束时调用 */
  onProjectRefresh: () => void;
}

export const Workbench = ({
  project,
  doctor,
  onRecheckDoctor,
  onSwitchFolder,
  onProjectRefresh,
}: WorkbenchProps) => {
  const [section, setSection] = useState<SectionKey>(() => initialSection(project));
  const [doctorOpen, setDoctorOpen] = useState(false);
  const capabilities = deriveCapabilities(project, doctor);
  const locked = project.root === project.path;
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

  // 任务状态挂在这一层而不是 Make 里:切区段会卸载 Make,那样 EventSource 被关掉、
  // jobId 丢失,切回来界面就退回"可以开工",点了拿 409 且再没有入口取消。
  // 放这里之后,渲染途中可以自由去看素材或成果,回来进度还在。
  const job = useJob(onProjectRefresh);
  const [activeKind, setActiveKind] = useState<JobKind | null>(null);
  const [undoIds, setUndoIds] = useState<string[]>([]);
  const [assetBusy, setAssetBusy] = useState(false);
  const [dialog, setDialog] = useState<{title: string; message: string; confirm?: () => Promise<void>; destructive?: boolean} | null>(null);

  // folder 在这里补上:起任务的组件只说要做什么,不必自己传素材夹路径
  const handleStart = (request: JobRequest) => {
    setActiveKind(request.kind);
    job.start({...request, folder: project.path});
  };

  const handleRemedy = (target: Remedy['target']) => {
    if (target === 'doctor') setDoctorOpen(true);
    else if (sectionUnlocked(target)) setSection(target);
  };
  const performAsset = async (item: AssetItem, action: 'rename' | 'delete', stem?: string): Promise<boolean> => {
    if (assetBusy || job.status === 'running') return false;
    setAssetBusy(true);
    const result = await mutateAsset(project.path, item.id, action, stem);
    setAssetBusy(false);
    if (!result.ok) { setDialog({title: '操作未完成', message: result.message}); return false; }
    if (result.data.undoId) setUndoIds((ids) => [...ids, result.data.undoId!]);
    onProjectRefresh();
    return true;
  };
  const handleAsset = (item: AssetItem, action: 'rename' | 'delete', stem?: string) => {
    if (action === 'delete') {
      setDialog({
        title: '删除这个文件？',
        message: `“${item.name}”会移入项目回收区，当前服务运行期间可以撤销。`,
        destructive: true,
        confirm: async () => {
          if (await performAsset(item, action, stem)) setDialog(null);
        },
      });
      return;
    }
    void performAsset(item, action, stem);
  };
  const handleUndo = async (undoId: string) => {
    if (assetBusy || job.status === 'running') return;
    setAssetBusy(true);
    const result = await undoAssetDelete(project.path, undoId);
    setAssetBusy(false);
    if (!result.ok) { setDialog({title: '撤销未完成', message: result.message}); return; }
    setUndoIds((ids) => ids.filter((id) => id !== undoId));
    onProjectRefresh();
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
            启动时锁定了素材夹的话(tsuzuri web <folder>),沙箱根就是这个素材夹,
            选择器里除了它自己什么都挑不到。那就不该摆一个点了只能选回原地的按钮 ——
            换成一个说明,并告诉用户换一种启动方式就能挑别的。
          */}
          {locked ? (
            <span className="folder-switch folder-switch-locked" title={`${project.path}\n启动时已锁定这个素材夹`}>
              <FolderOpen size={15} strokeWidth={1.5} />
              <span className="folder-switch-name">{middleTruncate(project.path)}</span>
            </span>
          ) : (
            <button className="folder-switch" onClick={onSwitchFolder} title={project.path}>
              <FolderOpen size={15} strokeWidth={1.5} />
              <span className="folder-switch-name">{middleTruncate(project.path)}</span>
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
            <CommandHint command="tsuzuri web" />
          </p>
        )}

        <main className="workbench-main">
          {undoIds.map((undoId) => <div className="asset-undo" key={undoId}><span>文件已移到项目回收区。</span><button className="link-button" disabled={assetBusy || job.status === 'running'} onClick={() => handleUndo(undoId)}>撤销</button></div>)}
          {section === 'materials' && (
            <Materials
              project={project}
              capabilities={capabilities}
              onRemedy={handleRemedy}
              job={job}
              activeKind={activeKind === 'fetch-audio' || activeKind === 'lyrics' ? activeKind : null}
              onStart={handleStart}
              onReset={() => setActiveKind(null)}
              onRefresh={onProjectRefresh}
              assetBusy={assetBusy || job.status === 'running'}
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
              onReset={() => setActiveKind(null)}
            />
          )}
          {section === 'results' && (
            <Results project={project} capabilities={capabilities} onRemedy={handleRemedy} assetBusy={assetBusy || job.status === 'running'} onAsset={handleAsset} />
          )}
        </main>
      </div>
      {dialog && <Dialog key={`${dialog.title}:${dialog.message}`} title={dialog.title} message={dialog.message} destructive={dialog.destructive} confirmLabel={dialog.confirm ? '删除' : '知道了'} onConfirm={dialog.confirm} onClose={() => setDialog(null)} />}
    </div>
  );
};
