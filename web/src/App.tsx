import {useState} from 'react';

import './App.css';
import {FolderPicker} from './FolderPicker';
import {PhotoGrid} from './PhotoGrid';
import type {ProjectResponse} from './types';

type Step = 1 | 2;

const App = () => {
  const [step, setStep] = useState<Step>(1);
  const [project, setProject] = useState<ProjectResponse | null>(null);

  const handleProjectLoaded = (loaded: ProjectResponse) => {
    setProject(loaded);
    setStep(2);
  };

  const goToStep = (target: Step) => {
    if (target === 2 && !project) return;
    setStep(target);
  };

  return (
    <div className="app">
      <header className="app-header">
        <h1 className="app-title">綴り</h1>
        <nav className="step-nav">
          <button className={step === 1 ? 'step-active' : ''} onClick={() => goToStep(1)}>
            ① 选择素材夹
          </button>
          <button className={step === 2 ? 'step-active' : ''} onClick={() => goToStep(2)}>
            ② 查看照片
          </button>
        </nav>
      </header>

      <main className="app-main">
        {step === 1 && <FolderPicker onProjectLoaded={handleProjectLoaded} />}
        {step === 2 && (project ? <PhotoGrid project={project} /> : <p className="hint">先选择一个素材夹吧。</p>)}
      </main>
    </div>
  );
};

export default App;
