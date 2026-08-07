/**
 * `tsuzuri web [folder]` —— 起本地工作台 server 并尝试打开默认浏览器.
 * 传入 folder 时,server 的路径沙箱根目录锁定为该 folder(浏览不出这个素材夹);
 * 不传时根目录锁定为用户主目录(os.homedir()),作为选择素材夹的起点,
 * 仍然沙箱化,不能访问主目录之外的任意路径.
 */
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {CliError} from './options.mjs';
import {installRuntimeShutdown} from './runtime-lifecycle.mjs';
import {createGalleryServer} from './web-server.mjs';
import {term} from './term.mjs';

const START_PORT = 3000;
const MAX_PORT_ATTEMPTS = 50;

/** 从 START_PORT 起找一个可用端口;每次都是新起的本地 server,不需要复用逻辑. */
const listenOnFreePort = (server) =>
  new Promise((resolve, reject) => {
    let attempt = 0;
    const tryPort = (port) => {
      server.once('error', (error) => {
        if (error.code === 'EADDRINUSE' && attempt < MAX_PORT_ATTEMPTS) {
          attempt += 1;
          tryPort(port + 1);
          return;
        }
        if (error.code === 'EADDRINUSE') {
          reject(new CliError(`试了 ${MAX_PORT_ATTEMPTS} 个端口都被占用,请手动释放端口后重试`));
          return;
        }
        reject(error);
      });
      server.listen(port, '127.0.0.1', () => resolve(port));
    };
    tryPort(START_PORT);
  });

/** 尝试用系统默认程序打开 URL;跨平台命令都试了仍失败也不报错,只提示手动打开. */
const tryOpenBrowser = (url) => {
  const platform = process.platform;
  const cmd = platform === 'darwin' ? 'open' : platform === 'win32' ? 'start' : 'xdg-open';
  try {
    const child = platform === 'win32'
      ? spawn('cmd', ['/c', 'start', '""', url], {stdio: 'ignore', detached: true})
      : spawn(cmd, [url], {stdio: 'ignore', detached: true});
    child.on('error', () => {
      term.detail(`未能自动打开浏览器,请手动访问: ${url}`);
    });
    child.unref();
  } catch {
    term.detail(`未能自动打开浏览器,请手动访问: ${url}`);
  }
};

/**
 * @param {string|null} folder 锁定的素材夹路径;null 时根目录为用户主目录
 * @param {{openBrowser?: boolean}} [opts] openBrowser=false 时跳过自动打开浏览器(测试用)
 * @returns {Promise<import('node:http').Server>}
 */
export const runWeb = async (folder = null, {openBrowser = true} = {}) => {
  let root;
  if (folder) {
    root = path.resolve(folder);
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
      throw new CliError(`不是文件夹: ${root}`);
    }
  } else {
    root = os.homedir();
  }

  const {server, killAll} = createGalleryServer(root);
  // 渲染任务的子进程是 detached 的(为了取消时能杀掉整棵进程树),代价是它脱离了
  // 终端进程组,用户按 Ctrl+C 时收不到 SIGINT.不在这里显式收尾,关掉 tsuzuri web
  // 之后 remotion/chromium 会变成孤儿,继续吃满 CPU 直到把那一次渲染跑完.
  const port = await listenOnFreePort(server);
  installRuntimeShutdown({server, killAll});
  const url = `http://localhost:${port}`;
  term.success(`本地工作台已启动: ${url}`);
  term.detail(folder ? `已锁定素材夹: ${root}` : `浏览起点: ${root}(用户主目录)`);
  term.detail('按 Ctrl+C 结束');
  if (openBrowser) tryOpenBrowser(url);
  return server;
};
