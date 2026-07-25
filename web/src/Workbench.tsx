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
}

export const Workbench = ({project, doctor, onRecheckDoctor, onSwitchFolder}: WorkbenchProps) => {
  const [section, setSection] = useState<SectionKey>(() => initialSection(project));
  const [doctorOpen, setDoctorOpen] = useState(false);
  const capabilities = deriveCapabilities(project, doctor);

  const handleRemedy = (target: Remedy['target']) => {
    if (target === 'doctor') setDoctorOpen(true);
    else setSection(target === 'make' ? 'make' : 'materials');
  };

  return (
    <div className="workbench">
      <header className="topbar">
        <Logo />
        <button className="folder-switch" onClick={onSwitchFolder} title="换一个素材夹">
          <FolderOpen size={15} strokeWidth={1.5} />
          {project.name}
        </button>
        <DoctorPanel
          doctor={doctor}
          open={doctorOpen}
          onToggle={() => setDoctorOpen((v) => !v)}
          onRecheck={onRecheckDoctor}
        />
      </header>

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
          <Materials project={project} capabilities={capabilities} onRemedy={handleRemedy} />
        )}
        {section === 'make' && (
          <Make project={project} capabilities={capabilities} onRemedy={handleRemedy} />
        )}
        {section === 'results' && (
          <Results project={project} capabilities={capabilities} onRemedy={handleRemedy} />
        )}
      </main>
    </div>
  );
};
