import {app, BrowserWindow, dialog, ipcMain, Menu, powerMonitor, shell} from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import {fileURLToPath, pathToFileURL} from 'node:url';

import {createDesktopRuntime} from './runtime.mjs';
import {prepareAnalyzerRuntime} from './analyzer-runtime.mjs';

let service;
let window;
let serviceUrl;
const recentProjects = [];
let modules;
let dockTimer;

const recentFile = () => path.join(app.getPath('userData'), 'recent-projects.json');
const persistRecentProjects = () => fs.writeFileSync(recentFile(), `${JSON.stringify(recentProjects.slice(0, 10), null, 2)}\n`, {mode: 0o600});

const authorizeProject = (candidate, {notify = false} = {}) => {
  const snapshot = service.switchRoot(candidate);
  const existing = recentProjects.indexOf(snapshot.path);
  if (existing >= 0) recentProjects.splice(existing, 1);
  recentProjects.unshift(snapshot.path);
  persistRecentProjects();
  Menu.setApplicationMenu(menu());
  if (notify && window && !window.isDestroyed()) window.webContents.send('kiseki:project-changed', snapshot.path);
  return snapshot;
};

const openProject = async () => {
  const result = await dialog.showOpenDialog(window, {properties: ['openDirectory', 'createDirectory']});
  return result.canceled ? null : authorizeProject(result.filePaths[0]);
};

const installIpc = () => {
  ipcMain.handle('kiseki:open-project', openProject);
  ipcMain.handle('kiseki:open-recent-project', (_event, candidate) => {
    if (typeof candidate !== 'string' || !recentProjects.includes(candidate)) throw new Error('项目不在最近列表');
    return authorizeProject(candidate);
  });
  ipcMain.handle('kiseki:open-dropped-project', (_event, candidate) => {
    if (typeof candidate !== 'string') throw new Error('拖入路径无效');
    return authorizeProject(candidate);
  });
  ipcMain.handle('kiseki:show-output', () => shell.openPath(path.join(service.getRoot().path, 'output')));
  ipcMain.handle('kiseki:cancel-job', () => service.cancelCurrentJob());
};

const initializeService = async () => {
  if (service) return;
  const cache = app.getPath('cache');
  const userData = app.getPath('userData');
  for (const directory of [cache, userData, path.join(cache, 'tmp'), path.join(userData, 'models')]) fs.mkdirSync(directory, {recursive: true, mode: 0o700});
  const runtime = createDesktopRuntime({resourcesPath: process.resourcesPath, userData, cache, packaged: app.isPackaged, createRuntimeLayout: modules.createRuntimeLayout});
  if (app.isPackaged) prepareAnalyzerRuntime(runtime);
  const rootController = modules.createMutableRootController();
  service = modules.createKisekiService({rootController, runtime, projectSelection: 'native', commandResolver: modules.createElectronCommandResolver({runtime, executable: process.execPath})});
  serviceUrl = (await service.start()).url;
  dockTimer = setInterval(() => {
    if (!window || window.isDestroyed()) return;
    const running = service.getRunningJob() !== null;
    window.setProgressBar(running ? 2 : -1, running ? {mode: 'indeterminate'} : undefined);
  }, 500);
  dockTimer.unref?.();
};

const createWindow = async () => {
  await initializeService();
  window = new BrowserWindow({width: 1280, height: 820, minWidth: 900, minHeight: 640, titleBarStyle: 'hiddenInset', webPreferences: {preload: path.join(path.dirname(fileURLToPath(import.meta.url)), 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true}});
  const origin = new URL(serviceUrl).origin;
  window.webContents.on('will-navigate', (event, target) => { if (new URL(target).origin !== origin) event.preventDefault(); });
  window.webContents.setWindowOpenHandler(() => ({action: 'deny'}));
  window.on('closed', () => { window = null; });
  await window.loadURL(serviceUrl);
};

const menu = () => Menu.buildFromTemplate([
  {role: 'appMenu', submenu: [
    {label: '打开项目…', accelerator: 'CmdOrCtrl+O', click: async () => { const result = await dialog.showOpenDialog(window, {properties: ['openDirectory', 'createDirectory']}); if (!result.canceled) authorizeProject(result.filePaths[0], {notify: true}); }},
    {label: '最近项目', submenu: recentProjects.length > 0 ? recentProjects.map((candidate) => ({label: path.basename(candidate), sublabel: candidate, click: () => authorizeProject(candidate, {notify: true})})) : [{label: '无', enabled: false}]},
    {label: '显示输出目录', click: () => shell.openPath(path.join(service.getRoot().path, 'output'))},
    {label: '取消当前任务', click: () => service.cancelCurrentJob()},
    {label: '设置…', accelerator: 'CmdOrCtrl+,', enabled: false},
    {type: 'separator'}, {role: 'quit'},
  ]},
  {role: 'editMenu'}, {role: 'viewMenu'}, {role: 'windowMenu'},
]);

if (!app.requestSingleInstanceLock()) app.quit();
else {
app.on('second-instance', () => {
  if (!window || window.isDestroyed()) void createWindow();
  else { if (window.isMinimized()) window.restore(); window.show(); window.focus(); }
});
app.whenReady().then(async () => {
  const cliRoot = app.isPackaged ? path.join(process.resourcesPath, 'kiseki-runtime', 'cli') : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../cli');
  const [{createRuntimeLayout}, {createElectronCommandResolver}, {createKisekiService}, {createMutableRootController}] = await Promise.all(['runtime-layout.mjs', 'command-resolver.mjs', 'kiseki-service.mjs', 'root-controller.mjs'].map((file) => import(pathToFileURL(path.join(cliRoot, file)).href)));
  modules = {createRuntimeLayout, createElectronCommandResolver, createKisekiService, createMutableRootController};
  try {
    const saved = JSON.parse(fs.readFileSync(recentFile(), 'utf8'));
    if (Array.isArray(saved)) for (const candidate of saved) if (typeof candidate === 'string' && fs.existsSync(candidate)) recentProjects.push(candidate);
  } catch {}
  installIpc(); Menu.setApplicationMenu(menu()); await createWindow();
  powerMonitor.on('resume', () => { service?.resumeAfterSleep(); if (window && !window.isDestroyed()) window.webContents.reload(); });
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) void createWindow(); });
}).catch((error) => { dialog.showErrorBox('Kiseki 无法启动', error.message); app.exit(1); });
}
app.on('before-quit', (event) => {
  if (app.isQuitting) { event.preventDefault(); return; }
  event.preventDefault();
  if (service?.getRunningJob() && dialog.showMessageBoxSync(window, {type: 'warning', buttons: ['继续渲染', '退出并取消任务'], defaultId: 0, cancelId: 0, message: '任务仍在进行，确定退出吗？'}) === 0) return;
  app.isQuitting = true;
  clearInterval(dockTimer);
  void Promise.resolve(service?.shutdown({deadlineMs: 8000}) ?? {clean: true})
    .then((result) => app.exit(result.clean ? 0 : 1), () => app.exit(1));
});
app.on('window-all-closed', () => {});
