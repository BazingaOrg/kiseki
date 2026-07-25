/**
 * tsuzuri 裸命令交互菜单:数字 + 回车,只在 TTY 且零参数时进入(入口判断在
 * tsuzuri.mjs)。菜单只组装 argv 交回 parseArgs,与命令行走同一条代码路径;
 * 执行前回显等效命令,用一次菜单就能学会直达写法。
 */

import os from 'node:os';
import fs from 'node:fs';

import {formatEquivalentCommand} from './command-format.mjs';
import {FILTER_IDS} from './filters.mjs';
import {PICK_BACK, withPrompts} from './prompts.mjs';
import {paint, term} from './term.mjs';

export const MENU_ITEMS = [
  {key: '1', label: '渲染相册视频', pathPrompt: '素材文件夹'},
  {key: '2', label: '导出静态作品图(still)', pathPrompt: '照片或文件夹'},
  {key: '3', label: '预览歌词识别(lyrics)', pathPrompt: '素材文件夹'},
  {key: '4', label: '检查依赖(doctor)', pathPrompt: null},
  {key: '5', label: '获取音频/歌词到素材夹(fetch)', pathPrompt: '素材文件夹'},
  {key: '6', label: '打开本地画廊(web)', pathPrompt: null},
];
export const MENU_BACK = Symbol('menu-back');

// 极简 ASCII(不用方框):规避全角字符在窄/等宽异常终端的对齐错位
const BANNER = [
  '  /\\_/\\   tsuzuri 綴',
  ' ( ·ᴥ· )  把照片和一首歌缀成影像日记',
];
const FAREWELL = [
  '  /\\_/\\',
  ' ( -ᴥ- )  晚安。素材都在原文件夹,随时再来。',
];

/** 只在裸命令进入交互菜单时打印;直接命令/管道绝不打印,保持可脚本性。 */
export const writeBanner = (output = process.stdout) => {
  output.write(`${BANNER.map((line) => paint('start', line, output)).join('\n')}\n\n`);
};

/** 只在从菜单 q 正常退出时打印。 */
export const writeFarewell = (output = process.stdout) => {
  output.write(`${FAREWELL.map((line) => paint('start', line, output)).join('\n')}\n`);
};

/**
 * 规整拖拽/手输路径。macOS 拖拽会反斜杠转义空格与括号(`My\ Photos`),
 * Windows 拖拽会整体带引号(`"C:\Users\me\My Photos"`);Windows 路径分隔符
 * `\` 后面只会跟字母数字,不会命中"反斜杠 + 特殊字符"的反转义规则。
 */
export const normalizeDroppedPath = (input) => {
  let s = String(input ?? '').trim();
  if (
    s.length >= 2 &&
    ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'")))
  ) {
    s = s.slice(1, -1).trim();
  }
  s = s.replace(/\\([^A-Za-z0-9_\\])/g, '$1');
  if (s === '~' || s.startsWith('~/')) {
    s = os.homedir() + s.slice(1);
  }
  return s;
};

/** 由菜单选择组装 argv,与命令行同一语义;未知选择返回 null。 */
export const buildArgvFromChoices = ({choice, target, exif = false, sign = false, dark = false, portrait = false, square = false, filter = null}) => {
  if (choice === '1') {
    const argv = [target];
    if (exif) argv.push('--exif');
    if (sign) argv.push('--sign');
    if (dark) argv.push('--dark');
    if (portrait) argv.push('--portrait');
    if (square) argv.push('--square');
    if (filter) argv.push('--filter', filter);
    return argv;
  }
  if (choice === '2') {
    const argv = ['still', target];
    if (exif) argv.push('--exif');
    if (sign) argv.push('--sign');
    if (dark) argv.push('--dark');
    if (portrait) argv.push('--portrait');
    if (square) argv.push('--square');
    if (filter) argv.push('--filter', filter);
    return argv;
  }
  if (choice === '3') return ['lyrics', target];
  if (choice === '4') return ['doctor'];
  if (choice === '5') return ['fetch', target];
  if (choice === '6') return ['web'];
  return null;
};

/**
 * 交互层:问答收集选择,返回 argv 数组;q 退出时返回 null。
 */
export const runMenu = async (
  {input = process.stdin, output = process.stdout, promptRunner = withPrompts} = {},
) => {
  return promptRunner(async (ask) => {
    for (const item of MENU_ITEMS) output.write(`  ${item.key}. ${item.label}\n`);
    output.write('\n');

    let item;
    for (;;) {
      const choice = await ask.line('选择操作', {
        allowQuit: false,
        legend: [`1-${MENU_ITEMS.length} 选择`, 'q 退出'],
      });
      if (choice.toLowerCase() === 'q') {
        writeFarewell(output);
        return null;
      }
      item = MENU_ITEMS.find((i) => i.key === choice);
      if (item) break;
      output.write(`无效选择,请输入 1-${MENU_ITEMS.length}\n`);
    }

    let target = null;
    if (item.pathPrompt) {
      const rawTarget = await ask.line(`拖入或输入「${item.pathPrompt}」路径`, {
        emptyBack: true,
        validate: (value) => {
          const normalized = normalizeDroppedPath(value);
          if (!normalized) return '路径不能为空';
          if (!fs.existsSync(normalized)) return `找不到路径: ${normalized}`;
          if (item.key !== '2' && !fs.statSync(normalized).isDirectory()) {
            return `不是文件夹: ${normalized}`;
          }
          return true;
        },
      });
      if (rawTarget === PICK_BACK) return MENU_BACK;
      target = normalizeDroppedPath(rawTarget);
    }

    let exif = false;
    let sign = false;
    let dark = false;
    let portrait = false;
    let square = false;
    let filter = null;
    if (item.key === '1' || item.key === '2') {
      exif = await ask.confirm('显示 EXIF 拍摄参数和相机信息?', {
        defaultValue: false, defaultLabel: '不显示', alternateKey: 'e', alternateLabel: '显示',
      });
      sign = await ask.confirm('加入签名落款,用于作品署名?', {
        defaultValue: false, defaultLabel: '不加入', alternateKey: 's', alternateLabel: '加入',
      });
      dark = await ask.confirm('使用黑色背景,适合暗色展陈?', {
        defaultValue: false, defaultLabel: '不使用', alternateKey: 'd', alternateLabel: '使用',
      });
      const format = await ask.pick('选择画幅', ['横版(沿用项目设置)', '竖版 1080×1920', '方形 1080×1080'], {
        allowBack: false, defaultIndex: 0, enterLabel: '横版(沿用项目设置)',
      });
      portrait = format.index === 1;
      square = format.index === 2;
      const filterChoice = await ask.pick('选择滤镜', ['无滤镜', ...FILTER_IDS], {
        allowBack: false, defaultIndex: 0, enterLabel: '无滤镜',
      });
      filter = filterChoice.index === 0 ? null : FILTER_IDS[filterChoice.index - 1];
    }

    const argv = buildArgvFromChoices({choice: item.key, target, exif, sign, dark, portrait, square, filter});
    term.detail(`等效命令: ${formatEquivalentCommand(argv)}`);
    if (!['4', '5', '6'].includes(item.key)) {
      term.detail('进阶配置(分辨率/过渡/字幕/背景…)见素材夹 tsuzuri.toml,参考 docs/config.md');
    }
    return argv;
  }, {input, output});
};
