import {FILTER_IDS, normalizeFilterId} from './filters.mjs';

export class CliError extends Error {}

const parseFilterIntensity = (raw, flagLabel) => {
  const value = Number(raw);
  if (!/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(raw) || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new CliError(`${flagLabel} 需要 0–1 之间的数字,收到 ${raw}`);
  }
  return value;
};

const parseFilterId = (raw) => {
  const id = normalizeFilterId(raw);
  if (!id) {
    throw new CliError(`--filter 未知滤镜 id: ${raw}(可选: ${FILTER_IDS.join(', ')})`);
  }
  return id;
};

const STILL_OPTIONS = '-o <out.png|dir>  --exif  --sign  --dark  --portrait|--square  --skip-existing  --scale <1-4>(默认 2)  --filter <id>  --filter-intensity <0-1>';
export const STILL_USAGE = `用法: tsuzuri still <photo|folder> ${STILL_OPTIONS}`;

export const USAGE =
  '用法:\n' +
  '  tsuzuri                                    不带参数进入常驻菜单(仅交互终端)\n' +
  '  tsuzuri <folder> [-o out.mp4] [--exif] [--sign] [--dark] [--portrait|--square] [--draft] [--trim auto|full|秒数] [--filter <id>] [--filter-intensity <0-1>]  渲染相册视频(默认命令)\n' +
  '  tsuzuri still <photo|folder> [选项]         按视频同款视觉导出静态图\n' +
  '  tsuzuri doctor                             检查依赖是否就绪\n' +
  '  tsuzuri lyrics <folder>                    只识别歌词并预览(不渲染)\n' +
  '  tsuzuri fetch <folder>                     在线获取音频/歌词到素材夹(交互)\n' +
  '  tsuzuri web [folder]                       启动本地工作台网页(支持改名/删除,可撤销,不传 folder 则从主目录选)\n' +
  '  tsuzuri help                               显示本说明(同 -h / --help)\n' +
  `still 选项: ${STILL_OPTIONS}\n` +
  '目录约定:文件夹内放照片(jpg/png/webp)+ 唯一的音频文件(mp3 等)\n' +
  '若文件夹名恰好叫 doctor / lyrics / still / fetch / web / help,用路径前缀转义,如 tsuzuri ./still';

const parseRenderArgs = (argv) => {
  const args = {command: 'render', folder: null, output: null, exif: false, sign: false, dark: false, portrait: false, square: false, draft: false, trim: null, filter: null};
  let filterId = null;
  let filterIntensity = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '-o' || argv[i] === '--output') {
      if (i + 1 >= argv.length || argv[i + 1].startsWith('-')) {
        throw new CliError(`${argv[i]} 需要输出文件路径`);
      }
      args.output = argv[++i];
    } else if (argv[i] === '--exif') {
      args.exif = true;
    } else if (argv[i] === '--sign') {
      args.sign = true;
    } else if (argv[i] === '--dark') {
      args.dark = true;
    } else if (argv[i] === '--portrait') {
      args.portrait = true;
    } else if (argv[i] === '--square') {
      args.square = true;
    } else if (argv[i] === '--draft') {
      args.draft = true;
    } else if (argv[i] === '--filter') {
      if (i + 1 >= argv.length || argv[i + 1].startsWith('-')) {
        throw new CliError(`--filter 需要滤镜 id(可选: ${FILTER_IDS.join(', ')})`);
      }
      filterId = parseFilterId(argv[++i]);
    } else if (argv[i] === '--filter-intensity') {
      if (i + 1 >= argv.length || argv[i + 1].startsWith('-')) {
        throw new CliError('--filter-intensity 需要 0–1 之间的数字');
      }
      filterIntensity = parseFilterIntensity(argv[++i], '--filter-intensity');
    } else if (argv[i] === '--trim') {
      if (i + 1 >= argv.length || argv[i + 1].startsWith('-')) {
        throw new CliError('--trim 需要 auto、full 或正数秒数');
      }
      const value = argv[++i];
      const seconds = /^\+?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value)
        && Number.isFinite(Number(value))
        && Number(value) > 0;
      if (!['auto', 'full'].includes(value) && !seconds) {
        throw new CliError(`--trim 必须是 auto、full 或正数秒数,收到 ${value}`);
      }
      args.trim = value;
    } else if (argv[i].startsWith('-')) {
      throw new CliError(`未知参数: ${argv[i]}(用法: tsuzuri <folder> [-o out.mp4] [--exif] [--sign] [--dark] [--draft] [--trim auto|full|秒数])`);
    } else if (!args.folder) {
      args.folder = argv[i];
    } else {
      throw new CliError(`未知参数: ${argv[i]}(用法: tsuzuri <folder> [-o out.mp4] [--exif] [--sign] [--dark] [--draft] [--trim auto|full|秒数])`);
    }
  }
  if (!args.folder) {
    throw new CliError(USAGE);
  }
  if (args.portrait && args.square) throw new CliError('--portrait 与 --square 不能同时使用');
  if (filterIntensity !== null && filterId === null) {
    throw new CliError('--filter-intensity 需要搭配 --filter <id> 使用');
  }
  if (filterId !== null) args.filter = {id: filterId, ...(filterIntensity !== null ? {intensity: filterIntensity} : {})};
  return args;
};

const parseDoctorArgs = (rest) => {
  if (rest.length > 0) {
    throw new CliError(`doctor 不接受额外参数: ${rest.join(' ')}\n用法: tsuzuri doctor`);
  }
  return {command: 'doctor'};
};

const parseLyricsArgs = (rest) => {
  const args = {command: 'lyrics', folder: null};
  for (const token of rest) {
    if (token === '-o' || token === '--output') {
      throw new CliError('lyrics 不支持 -o(只在终端预览,不生成文件)\n用法: tsuzuri lyrics <folder>');
    }
    if (!args.folder) {
      args.folder = token;
    } else {
      throw new CliError(`未知参数: ${token}(用法: tsuzuri lyrics <folder>)`);
    }
  }
  if (!args.folder) {
    throw new CliError('用法: tsuzuri lyrics <folder>');
  }
  return args;
};

const parseFetchArgs = (rest) => {
  const args = {command: 'fetch', folder: null};
  for (const token of rest) {
    if (!args.folder && !token.startsWith('-')) {
      args.folder = token;
    } else {
      throw new CliError(`未知参数: ${token}(用法: tsuzuri fetch <folder>)`);
    }
  }
  if (!args.folder) {
    throw new CliError('用法: tsuzuri fetch <folder>');
  }
  return args;
};

const parseWebArgs = (rest) => {
  const args = {command: 'web', folder: null};
  for (const token of rest) {
    if (!args.folder && !token.startsWith('-')) {
      args.folder = token;
    } else {
      throw new CliError(`未知参数: ${token}(用法: tsuzuri web [folder])`);
    }
  }
  return args;
};

const parseStillArgs = (rest) => {
  const args = {
    command: 'still',
    target: null,
    output: null,
    exif: false,
    sign: false,
    dark: false,
    portrait: false,
    square: false,
    skipExisting: false,
    scale: 2,
    filter: null,
  };
  let filterId = null;
  let filterIntensity = null;
  for (let i = 0; i < rest.length; i++) {
    const token = rest[i];
    if (token === '-o' || token === '--output') {
      if (i + 1 >= rest.length || rest[i + 1].startsWith('-')) {
        throw new CliError(`${token} 需要输出路径(文件 .png 或目录)`);
      }
      args.output = rest[++i];
    } else if (token === '--exif') {
      args.exif = true;
    } else if (token === '--sign') {
      args.sign = true;
    } else if (token === '--dark') {
      args.dark = true;
    } else if (token === '--portrait') {
      args.portrait = true;
    } else if (token === '--square') {
      args.square = true;
    } else if (token === '--skip-existing') {
      args.skipExisting = true;
    } else if (token === '--scale') {
      if (i + 1 >= rest.length || rest[i + 1].startsWith('-')) {
        throw new CliError('--scale 需要 1–4 的整数');
      }
      const raw = rest[++i];
      if (!/^[1-4]$/.test(raw)) {
        throw new CliError(`--scale 必须是 1–4 的整数,收到 ${raw}`);
      }
      args.scale = Number(raw);
    } else if (token === '--filter') {
      if (i + 1 >= rest.length || rest[i + 1].startsWith('-')) {
        throw new CliError(`--filter 需要滤镜 id(可选: ${FILTER_IDS.join(', ')})`);
      }
      filterId = parseFilterId(rest[++i]);
    } else if (token === '--filter-intensity') {
      if (i + 1 >= rest.length || rest[i + 1].startsWith('-')) {
        throw new CliError('--filter-intensity 需要 0–1 之间的数字');
      }
      filterIntensity = parseFilterIntensity(rest[++i], '--filter-intensity');
    } else if (token.startsWith('-')) {
      throw new CliError(`未知参数: ${token}\n${STILL_USAGE}`);
    } else if (!args.target) {
      args.target = token;
    } else {
      throw new CliError(`未知参数: ${token}\n${STILL_USAGE}`);
    }
  }
  if (!args.target) {
    throw new CliError(STILL_USAGE);
  }
  if (args.portrait && args.square) throw new CliError('--portrait 与 --square 不能同时使用');
  if (filterIntensity !== null && filterId === null) {
    throw new CliError('--filter-intensity 需要搭配 --filter <id> 使用');
  }
  if (filterId !== null) args.filter = {id: filterId, ...(filterIntensity !== null ? {intensity: filterIntensity} : {})};
  return args;
};

/**
 * A leading token exactly equal to `doctor`, `lyrics`, `still`, `fetch` or `help` is always the verb.
 * Any path-qualified token (`./lyrics`, `/abs/path`, ...) is not a bare verb
 * string, so it never matches here and falls through to the render command —
 * that's the escape hatch for a folder that happens to be named after a verb.
 */
export const parseArgs = (argv) => {
  const [first, ...rest] = argv;
  if (first === 'doctor') return parseDoctorArgs(rest);
  if (first === 'lyrics') return parseLyricsArgs(rest);
  if (first === 'fetch') return parseFetchArgs(rest);
  if (first === 'still') return parseStillArgs(rest);
  if (first === 'web') return parseWebArgs(rest);
  if (first === 'help' || first === '-h' || first === '--help') return {command: 'help'};
  return parseRenderArgs(argv);
};
