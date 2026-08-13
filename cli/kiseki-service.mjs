import {createGalleryServer} from './web-server.mjs';
import {RootBusyError} from './root-controller.mjs';
import {canonicalizeAuthorizedRoot} from './root-controller.mjs';
import {sourceRuntimeLayout} from './runtime-layout.mjs';
import {CliError} from './options.mjs';

const listen = (server, startPort = 3000, attempts = 50) => new Promise((resolve, reject) => {
  let offset = 0;
  const tryPort = () => {
    const port = startPort + offset;
    server.once('error', (error) => {
      if (error.code === 'EADDRINUSE' && offset + 1 < attempts) { offset += 1; tryPort(); }
      else reject(error.code === 'EADDRINUSE' ? new CliError(`试了 ${attempts} 个端口都被占用,请手动释放端口后重试`) : error);
    });
    server.listen(port, '127.0.0.1', () => resolve(port));
  };
  tryPort();
});

const closeServer = (server) => new Promise((resolve) => {
  if (!server.listening) { resolve(); return; }
  server.close(() => resolve());
});

export const createKisekiService = ({rootController, runtime = sourceRuntimeLayout, commandResolver, startPort = 3000, serverDeps = {}}) => {
  const context = createGalleryServer(rootController, {...serverDeps, runtime, ...(commandResolver ? {commandResolver} : {})});
  let started = null;
  let shutdownPromise = null;
  return Object.freeze({
    server: context.server,
    token: context.token,
    start: async () => {
      if (shutdownPromise) throw new Error('服务正在关闭');
      if (started) return started;
      const port = await listen(context.server, startPort);
      started = Object.freeze({port, url: `http://localhost:${port}`, token: context.token});
      return started;
    },
    getRoot: () => rootController.getSnapshot(),
    getRunningJob: () => context.jobManager.getRunningJob(),
    cancelCurrentJob: () => {
      const job = context.jobManager.getRunningJob();
      return job ? context.jobManager.cancelJob(job.id) : false;
    },
    resumeAfterSleep: () => context.jobManager.resumeAfterSleep(),
    switchRoot: (candidate) => {
      if (shutdownPromise) throw new Error('服务正在关闭');
      if (!rootController.mutable) throw new TypeError('当前服务的项目根目录不可切换');
      if (context.jobManager.hasRunningJob() || context.writeGate.isBusy()) throw new RootBusyError('任务或文件操作进行中，无法切换项目');
      const next = canonicalizeAuthorizedRoot(candidate);
      if (!context.resetRootState()) throw new RootBusyError('项目存在待恢复的文件操作，无法切换');
      return rootController.setSnapshot(next);
    },
    shutdown: (options) => {
      shutdownPromise ??= (async () => {
        context.beginClosing();
        const [result] = await Promise.all([context.killAll(options), closeServer(context.server), context.writeGate.waitForIdle()]);
        return result;
      })();
      return shutdownPromise;
    },
  });
};
