const {contextBridge, ipcRenderer, webUtils} = require('electron');

contextBridge.exposeInMainWorld('kisekiDesktop', Object.freeze({
  openProject: () => ipcRenderer.invoke('kiseki:open-project'),
  openRecentProject: (projectPath) => ipcRenderer.invoke('kiseki:open-recent-project', projectPath),
  openDroppedProject: (file) => ipcRenderer.invoke('kiseki:open-dropped-project', webUtils.getPathForFile(file)),
  showOutput: () => ipcRenderer.invoke('kiseki:show-output'),
  cancelJob: () => ipcRenderer.invoke('kiseki:cancel-job'),
}));
