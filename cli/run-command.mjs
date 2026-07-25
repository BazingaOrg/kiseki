import {spawnSync} from 'node:child_process';

import {FIXES} from './dependencies.mjs';
import {jsonProgressEnabled, term} from './term.mjs';

const STAGE_DETAILS = {
  '分析音频': '具体原因见上方 analyzer 输出;首次运行需联网下载模型,网络问题可重试',
  '识别歌词': '具体原因见上方 analyzer 输出;首次运行需联网下载模型,网络问题可重试',
  '规划照片时间线': '具体原因见上方 analyzer 输出',
  '渲染视频': '具体原因见上方输出;依赖问题可先跑 tsuzuri doctor',
};

/**
 * 结构化进度出口开启时的 stdio。`'inherit'` 只继承 0/1/2,fd 3 传不下去 ——
 * 而渲染的百分比全部产生在 `render.mjs` 这个孙进程里(它一次 term.* 都不调),
 * 不显式把 3 传下去,网页上的进度条就永远是不确定态,等于这个功能没做。
 * uv 那两次调用也会拿到 fd 3,Python 不写它,无害。
 */
const stdioFor = (env) =>
  jsonProgressEnabled(env) ? ['inherit', 'inherit', 'inherit', 3] : 'inherit';

export const runCommand = (stage, cmd, args, opts = {}, spawn = spawnSync, env = process.env) => {
  const result = spawn(cmd, args, {stdio: stdioFor(env), ...opts});
  if (result.error) {
    if (result.error.code === 'ENOENT') {
      term.error(`${stage}失败: 找不到命令 ${cmd}(未安装或不在 PATH)`);
      if (FIXES[cmd]) term.detail(FIXES[cmd]);
      term.detail('运行 tsuzuri doctor 可一次检查全部依赖');
    } else {
      term.error(`${stage}失败: 无法执行 ${cmd}: ${result.error.message}`);
    }
    return 1;
  }
  if (result.status !== 0) {
    const code = result.status ?? 1;
    term.error(`${stage}失败(退出码 ${code})`);
    if (STAGE_DETAILS[stage]) term.detail(STAGE_DETAILS[stage]);
    return code;
  }
  return 0;
};

