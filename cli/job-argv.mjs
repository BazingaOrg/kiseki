import {FILTER_IDS, normalizeFilterId} from './filters.mjs';

export class JobValidationError extends Error {
  constructor(field, message) {
    super(message);
    this.field = field;
  }
}

const FORMATS = ['landscape', 'portrait', 'square'];
const TRIM_VALUES = ['auto', 'full'];

/**
 * 把 {kind, folder, options} 组装成 tsuzuri CLI 的 argv 数组。
 * `folder` 在这里已经是调用方(HTTP 层)用 resolveSafePath 校验过的绝对路径,
 * 本函数不做任何 fs 校验,只做字段合法性校验与 argv 拼接——这是唯一被允许
 * 生成 argv 的地方,前端传来的原始 argv/命令字符串一律不被接受(契约二安全前提 1)。
 * @param {{kind: 'render'|'still', folder: string, options?: object}} params
 * @returns {string[]}
 */
export const buildJobArgv = ({kind, folder, options = {}}) => {
  // lyrics 只认一个文件夹和显式 replace;放在最前面,免得下面的渲染选项校验
  // 对它生效(前端就算多传了 format 之类也一律不影响 argv)。
  if (kind === 'lyrics') {
    const replace = options?.replace;
    if (replace !== undefined && typeof replace !== 'boolean') throw new JobValidationError('replace', 'replace 必须是布尔值');
    return ['lyrics', folder, ...(replace ? ['--replace'] : [])];
  }
  if (kind !== 'render' && kind !== 'still') {
    throw new JobValidationError('kind', 'kind 必须是 render、still 或 lyrics');
  }
  const opts = options ?? {};
  const flags = [];
  if (opts.output !== undefined && (typeof opts.output !== 'string' || !opts.output.trim())) {
    throw new JobValidationError('output', 'output 必须是非空字符串');
  }

  const readBool = (field) => {
    const value = opts[field];
    if (value === undefined) return false;
    if (typeof value !== 'boolean') {
      throw new JobValidationError(field, `${field} 必须是布尔值`);
    }
    return value;
  };

  if (readBool('exif')) flags.push('--exif');
  if (readBool('sign')) flags.push('--sign');
  if (readBool('dark')) flags.push('--dark');

  const format = opts.format === undefined ? 'landscape' : opts.format;
  if (!FORMATS.includes(format)) {
    throw new JobValidationError('format', 'format 必须是 landscape、portrait 或 square 之一');
  }
  if (format === 'portrait') flags.push('--portrait');
  if (format === 'square') flags.push('--square');

  const hasFilter = opts.filter !== undefined && opts.filter !== null;
  const filter = hasFilter ? normalizeFilterId(opts.filter) : null;
  if (hasFilter && !filter) {
    throw new JobValidationError('filter', `filter 必须是以下之一: ${FILTER_IDS.join(', ')}`);
  }

  const hasFilterIntensity = opts.filterIntensity !== undefined && opts.filterIntensity !== null;
  if (hasFilterIntensity) {
    if (typeof opts.filterIntensity !== 'number' || opts.filterIntensity < 0 || opts.filterIntensity > 1) {
      throw new JobValidationError('filterIntensity', 'filterIntensity 必须是 0–1 之间的数字');
    }
    if (!hasFilter) {
      throw new JobValidationError('filterIntensity', '--filter-intensity 需要搭配 --filter <id> 使用');
    }
  }

  if (hasFilter) flags.push('--filter', filter);
  if (hasFilterIntensity) flags.push('--filter-intensity', String(opts.filterIntensity));

  if (kind === 'render') {
    const draft = readBool('draft');
    if (draft) flags.push('--draft');

    const hasTrim = opts.trim !== undefined && opts.trim !== null;
    if (hasTrim) {
      if (!TRIM_VALUES.includes(opts.trim)) {
        throw new JobValidationError('trim', 'trim 必须是 auto 或 full');
      }
      flags.push('--trim', opts.trim);
    }
  }

  if (kind === 'still') {
    const scale = opts.scale === undefined ? 2 : opts.scale;
    if (typeof scale !== 'number' || !Number.isInteger(scale) || scale < 1 || scale > 4) {
      throw new JobValidationError('scale', 'scale 必须是 1–4 的整数');
    }
    if (scale !== 2) flags.push('--scale', String(scale));
  }

  if (opts.output !== undefined) flags.push('-o', opts.output);

  return kind === 'still' ? ['still', folder, ...flags] : [folder, ...flags];
};

/**
 * 渲染速度档位 → TSUZURI_CONCURRENCY。
 *
 * 走环境变量而不是新增一个 CLI flag:这个旋钮本来就存在、已文档化,渲染那侧
 * (`resolveRenderSettings`)读的就是它,加个 flag 等于让同一件事有两个入口。
 * 值仍然是从白名单枚举映射出来的常量,前端碰不到任意字符串(契约二安全前提 1)。
 *
 * `balanced` 不设并发值,直接用 CLI 的默认(一半核心)——少一个可能跑偏的来源。
 * 速度档位本身另行透传给渲染前诊断，不参与并发计算。
 */
const SPEED_ENV = {
  saver: '25%',
  balanced: null,
  full: '90%',
};

/**
 * 根据 options.speed 算出要塞给子进程的环境变量。
 * @param {{speed?: string}} options
 * @returns {Record<string, string>}
 */
export const buildJobEnv = (options = {}) => {
  const speed = options?.speed === undefined || options?.speed === null ? 'balanced' : options.speed;
  if (!Object.prototype.hasOwnProperty.call(SPEED_ENV, speed)) {
    throw new JobValidationError('speed', 'speed 必须是 saver、balanced 或 full');
  }
  const concurrencyEnv = SPEED_ENV[speed];
  return {
    TSUZURI_RENDER_SPEED: speed,
    ...(concurrencyEnv === null ? {} : {TSUZURI_CONCURRENCY: concurrencyEnv}),
  };
};

/**
 * 组合 buildJobArgv 与 buildJobEnv,一次性拿到 argv 与 env。
 * @param {{kind: string, folder: string, options?: object}} params
 * @returns {{argv: string[], env: Record<string, string>}}
 */
export const buildJobInvocation = ({kind, folder, options = {}}) => ({
  argv: buildJobArgv({kind, folder, options}),
  env: buildJobEnv(options),
});
