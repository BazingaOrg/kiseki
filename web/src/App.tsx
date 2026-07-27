/**
 * 两个状态,不是四个页签:
 *   没选素材夹 → 全屏欢迎页,**连导航栏都不存在**
 *   选了素材夹 → 工作台
 *
 * 门禁做成"无处可点"而不是"一排灰按钮":没什么要解释的,也就不必解释。
 */
import {useEffect, useRef, useState} from 'react';

import './App.css';
import {FolderPicker} from './FolderPicker';
import {createLatestGate} from './latest';
import {Logo} from './Logo';
import type {DoctorResponse, DoctorState, ProjectResponse} from './types';
import {Workbench} from './Workbench';

const App = () => {
  const [project, setProject] = useState<ProjectResponse | null>(null);
  const [doctor, setDoctor] = useState<DoctorState>('loading');
  const [projectStale, setProjectStale] = useState(false);
  const refreshGate = useRef(createLatestGate()).current;

  // 环境检查与素材夹无关,进页面就查一次。查失败要落到 'unavailable' 而不是
  // 留在 'loading' —— 后者会让 deriveCapabilities 一直挂起依赖判断,
  // 于是一台没装 ffmpeg 的机器上仍然显示"素材齐了，可以开工"
  const loadDoctor = () => {
    setDoctor('loading');
    fetch('/api/doctor')
      .then((res) => {
        if (!res.ok) throw new Error('failed');
        return res.json();
      })
      .then((data: DoctorResponse) => setDoctor(data))
      .catch(() => setDoctor('unavailable'));
  };

  useEffect(loadDoctor, []);

  // 任务跑完（渲染/导出）后重新拉一次素材夹状态,「成果」区段才能看到新产物 ——
  // 不重新 setProject 整个组件树都不知道多了一份成片
  const refreshProject = () => {
    if (project === null) return;
    const ticket = refreshGate.begin();
    fetch(`/api/project?path=${encodeURIComponent(project.path)}`)
      .then((res) => {
        if (!res.ok) throw new Error('failed');
        return res.json();
      })
      .then((data: ProjectResponse) => {
        if (!refreshGate.isCurrent(ticket)) return;
        setProject(data);
        setProjectStale(false);
      })
      .catch(() => {
        if (refreshGate.isCurrent(ticket)) setProjectStale(true);
      });
  };

  if (project === null) {
    return (
      <main className="welcome">
        <Logo size={56} variant="hero" />
        <p className="welcome-lead">
          先挑一个素材夹。<br />
          里面放着照片、一首歌，剩下的交给 tsuzuri。
        </p>
        <FolderPicker onProjectLoaded={setProject} />
      </main>
    );
  }

  return (
    <Workbench
      project={project}
      doctor={doctor}
      onRecheckDoctor={loadDoctor}
      onSwitchFolder={() => setProject(null)}
      onProjectRefresh={refreshProject}
      projectStale={projectStale}
    />
  );
};

export default App;
