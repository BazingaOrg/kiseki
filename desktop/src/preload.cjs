const {contextBridge, ipcRenderer, webUtils} = require('electron');

contextBridge.exposeInMainWorld('kisekiDesktop', Object.freeze({
  openProject: () => ipcRenderer.invoke('kiseki:open-project'),
  openRecentProject: (projectPath) => ipcRenderer.invoke('kiseki:open-recent-project', projectPath),
  openDroppedProject: (file) => ipcRenderer.invoke('kiseki:open-dropped-project', webUtils.getPathForFile(file)),
  onProjectChanged: (callback) => {
    const listener = (_event, projectPath) => callback(projectPath);
    ipcRenderer.on('kiseki:project-changed', listener);
    return () => ipcRenderer.removeListener('kiseki:project-changed', listener);
  },
  showOutput: () => ipcRenderer.invoke('kiseki:show-output'),
  cancelJob: () => ipcRenderer.invoke('kiseki:cancel-job'),
}));
