/**
 * tsuzuri.toml 统一配置 schema.唯一真源——analyzer/config_schema.py 镜像同一份
 * 字段表(两侧各自实现,字段/约束/默认值必须保持一致,交叉检查见
 * examples/config-cases.json).
 *
 * 本项目目前只有作者本人使用,不做任何兼容层:未知键、非法值、已弃用键一律
 * 直接报错退出,不做 warning 静默降级.
 */

import fs from 'node:fs';
import path from 'node:path';

import {CliError} from './options.mjs';
import {parseFlatToml} from './toml.mjs';

const BACKGROUND_RE = /^#[0-9a-fA-F]{6}$/;

const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value);
const isNumericKind = (kind) => kind === 'int' || kind === 'float';
const isFileInsideFolder = (folder, relativePath) => {
  if (path.isAbsolute(relativePath)) return false;
  const candidate = path.resolve(folder, relativePath);
  if (!fs.existsSync(candidate)) return false;
  const root = fs.realpathSync(folder);
  const resolved = fs.realpathSync(candidate);
  const relative = path.relative(root, resolved);
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
};

/** 已弃用且不再生效的键——出现即报错,不是 warning 通道. */
const DEPRECATED_KEYS = new Set(['motion', 'kenburns_from', 'kenburns_to']);

export const CONFIG_SCHEMA = {
  width: {
    default: 1920,
    example: 'width = 1920',
    expected: '正整数',
    validate: (value, kind) => kind === 'int' && isFiniteNumber(value) && value > 0,
  },
  height: {
    default: 1080,
    example: 'height = 1080',
    expected: '正整数',
    validate: (value, kind) => kind === 'int' && isFiniteNumber(value) && value > 0,
  },
  fps: {
    default: 60,
    example: 'fps = 60',
    expected: '1–240 之间的整数(不接受 60.0 这样的小数字面量)',
    validate: (value, kind) => kind === 'int' && isFiniteNumber(value) && value >= 1 && value <= 240,
  },
  background: {
    default: '#FFFFFF',
    example: 'background = "#FFFFFF"',
    expected: '6 位十六进制颜色字符串(如 "#FFFFFF")',
    validate: (value, kind) => kind === 'string' && BACKGROUND_RE.test(value),
  },
  photo_scale: {
    default: 0.8,
    example: 'photo_scale = 0.8',
    expected: '0–1 之间的数字(不含 0)',
    validate: (value, kind) => isNumericKind(kind) && isFiniteNumber(value) && value > 0 && value <= 1,
  },
  transition: {
    default: 'album',
    example: 'transition = "album"',
    expected: '"album"、"cut" 或 "crossfade"',
    validate: (value, kind) => kind === 'string' && ['album', 'cut', 'crossfade'].includes(value),
  },
  album_fade: {
    default: 0.4,
    example: 'album_fade = 0.4',
    expected: '大于等于 0 的数字',
    validate: (value, kind) => isNumericKind(kind) && isFiniteNumber(value) && value >= 0,
  },
  crossfade: {
    default: 0.6,
    example: 'crossfade = 0.6',
    expected: '大于等于 0 的数字',
    validate: (value, kind) => isNumericKind(kind) && isFiniteNumber(value) && value >= 0,
  },
  min_gap: {
    default: 2.0,
    example: 'min_gap = 2.0',
    expected: '大于 0 的数字',
    validate: (value, kind) => isNumericKind(kind) && isFiniteNumber(value) && value > 0,
  },
  flash_min_gap: {
    default: 0.8,
    example: 'flash_min_gap = 0.8',
    expected: '大于 0 的数字',
    validate: (value, kind) => isNumericKind(kind) && isFiniteNumber(value) && value > 0,
  },
  flash_avg_threshold: {
    default: 2.0,
    example: 'flash_avg_threshold = 2.0',
    expected: '大于 0 的数字',
    validate: (value, kind) => isNumericKind(kind) && isFiniteNumber(value) && value > 0,
  },
  trim_avg_threshold: {
    default: 10.0,
    example: 'trim_avg_threshold = 10.0',
    expected: '大于 0 的数字',
    validate: (value, kind) => isNumericKind(kind) && isFiniteNumber(value) && value > 0,
  },
  trim_target_avg: {
    default: 8.0,
    example: 'trim_target_avg = 8.0',
    expected: '大于 0 的数字',
    validate: (value, kind) => isNumericKind(kind) && isFiniteNumber(value) && value > 0,
  },
  pacing: {
    default: 'dynamic',
    example: 'pacing = "dynamic"',
    expected: '"dynamic" 或 "uniform"',
    validate: (value, kind) => kind === 'string' && ['dynamic', 'uniform'].includes(value),
  },
  trim: {
    default: 'auto',
    example: 'trim = "auto"',
    expected: '"auto"、"full" 或大于 0 的秒数',
    validate: (value, kind) => {
      if (kind === 'string') return value === 'auto' || value === 'full';
      if (isNumericKind(kind)) return isFiniteNumber(value) && value > 0;
      return false;
    },
  },
  subtitles: {
    default: true,
    example: 'subtitles = true',
    expected: '布尔值 true/false',
    validate: (value, kind) => kind === 'bool',
  },
  chapters: {
    default: true,
    example: 'chapters = true',
    expected: '布尔值 true/false',
    validate: (value, kind) => kind === 'bool',
  },
  demucs: {
    default: true,
    example: 'demucs = true',
    expected: '布尔值 true/false',
    validate: (value, kind) => kind === 'bool',
  },
  intro: {
    default: true,
    example: 'intro = true',
    expected: '布尔值 true/false',
    validate: (value, kind) => kind === 'bool',
  },
  outro_text: {
    default: '',
    example: 'outro_text = "完"',
    expected: '不含换行符的字符串',
    validate: (value, kind) => kind === 'string' && !value.includes('\n'),
  },
  signature: {
    default: '',
    example: 'signature = "signature.svg"',
    expected: '空字符串,或以 .svg 结尾且存在于素材夹内的相对路径',
    validate: (value, kind, folder) => {
      if (kind !== 'string') return false;
      if (value === '') return true;
      if (!value.toLowerCase().endsWith('.svg')) return false;
      return isFileInsideFolder(folder, value);
    },
  },
};

const DEFAULTS = Object.fromEntries(
  Object.entries(CONFIG_SCHEMA).map(([key, field]) => [key, field.default]),
);

const formatReceived = (value, kind) => (kind === 'string' ? JSON.stringify(value) : String(value));

const buildFieldError = (lineNo, key, field, received) =>
  new CliError(
    `tsuzuri.toml 第 ${lineNo} 行: ${key} 需要${field.expected},收到 ${received}\n` +
    `└ 例: ${field.example}`,
  );

/**
 * 读取素材夹下的 tsuzuri.toml,校验后返回 `{values, explicitKeys}`.
 * - `values`: 全字段配置(未显式出现的键取 CONFIG_SCHEMA 默认值)
 * - `explicitKeys`: 文件中显式出现过的键名集合
 * 文件不存在时返回全默认值与空集合.语法错误或字段非法一律抛 CliError,
 * 只报告遇到的第一个错误(按文件出现顺序).
 */
export const loadProjectConfig = (folder) => {
  const tomlPath = path.join(folder, 'tsuzuri.toml');
  if (!fs.existsSync(tomlPath)) {
    return {values: {...DEFAULTS}, explicitKeys: new Set()};
  }

  const text = fs.readFileSync(tomlPath, 'utf8');
  let parsed;
  try {
    parsed = parseFlatToml(text);
  } catch (err) {
    throw new CliError(`tsuzuri.toml ${err.message}`);
  }
  const {values: raw, lineOf, kinds} = parsed;

  const values = {...DEFAULTS};
  for (const key of Object.keys(raw)) {
    if (DEPRECATED_KEYS.has(key)) {
      throw new CliError(`tsuzuri.toml 第 ${lineOf[key]} 行: ${key} 已弃用且不再生效,请删除该行`);
    }
    const field = CONFIG_SCHEMA[key];
    if (!field) {
      throw new CliError(
        `tsuzuri.toml 第 ${lineOf[key]} 行: 未知配置项 ${key}\n└ 删除该行,或检查是否拼写错误`,
      );
    }
    const value = raw[key];
    const kind = kinds[key];
    if (!field.validate(value, kind, folder)) {
      throw buildFieldError(lineOf[key], key, field, formatReceived(value, kind));
    }
    values[key] = value;
  }

  return {values, explicitKeys: new Set(Object.keys(raw))};
};
