/**
 * 选定素材夹之后的工作台:顶栏 + 素材 / 制作 / 成果 三段。
 *
 * 三段之间不加强制线性锁 —— 用户可能只想看看已有的成果,没理由逼他先走一遍素材。
 * 门禁锁在**能力**粒度上(deriveCapabilities),这比锁在页面粒度上既更准确,
 * 挫败感也更低。
 */
import {useState} from 'react';
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
import type {JobKind, JobRequest} from './useJob';
import {useJob} from './useJob';

type SectionKey = 'materials' | 'make' | 'results';

const SECTIONS: {key: SectionKey; label: string}[] = [
  {key: 'materials', label: '素材'},
  {key: 'make', label: '制作'},
  {key: 'results', label: '成果'},
];

/** 有成果就直接给他看成果,否则从素材开始 —— 少一次点击。 */
const initialSection = (project: ProjectResponse): SectionKey =>
  project.output.videos.length > 0 || project.output.stills.length > 0 ? 'results' : 'materials';

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

  // 任务状态挂在这一层而不是 Make 里:切区段会卸载 Make,那样 EventSource 被关掉、
  // jobId 丢失,切回来界面就退回"可以开工",点了拿 409 且再没有入口取消。
  // 放这里之后,渲染途中可以自由去看素材或成果,回来进度还在。
  const job = useJob(onProjectRefresh);
  const [activeKind, setActiveKind] = useState<JobKind | null>(null);

  // folder 在这里补上:起任务的组件只说要做什么,不必自己传素材夹路径
  const handleStart = (request: JobRequest) => {
    setActiveKind(request.kind);
    job.start({...request, folder: project.path});
  };

  const handleRemedy = (target: Remedy['target']) => {
    if (target === 'doctor') setDoctorOpen(true);
    else setSection(target === 'make' ? 'make' : 'materials');
  };

  return (
    <div className="workbench">
      <header className="topbar">
        <Logo />
        {/*
          启动时锁定了素材夹的话(tsuzuri web <folder>),沙箱根就是这个素材夹,
          选择器里除了它自己什么都挑不到。那就不该摆一个点了只能选回原地的按钮 ——
          换成一个说明,并告诉用户换一种启动方式就能挑别的。
        */}
        {locked ? (
          <span className="folder-switch folder-switch-locked" title="启动时已锁定这个素材夹">
            <FolderOpen size={15} strokeWidth={1.5} />
            {project.name}
          </span>
        ) : (
          <button className="folder-switch" onClick={onSwitchFolder} title="换一个素材夹">
            <FolderOpen size={15} strokeWidth={1.5} />
            {project.name}
          </button>
        )}
        <DoctorPanel
          doctor={doctor}
          open={doctorOpen}
          onToggle={() => setDoctorOpen((v) => !v)}
          onRecheck={onRecheckDoctor}
        />
      </header>

      {/* 光把切换按钮禁掉不够 —— 得说清为什么换不了、以及怎么才能换 */}
      {locked && (
        <p className="locked-note">
          启动时锁定了这个素材夹，页面里换不了。想挑别的，改用不带参数的启动方式：
          <CommandHint command="tsuzuri web" />
        </p>
      )}

      <nav className="section-nav">
        {SECTIONS.map((item) => (
          <button
            key={item.key}
            className={section === item.key ? 'section-tab section-tab-active' : 'section-tab'}
            onClick={() => setSection(item.key)}
          >
            {item.label}
          </button>
        ))}
      </nav>

      <main className="workbench-main">
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
          <Results project={project} capabilities={capabilities} onRemedy={handleRemedy} />
        )}
      </main>
    </div>
  );
};
