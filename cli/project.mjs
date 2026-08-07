import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import {CliError} from './options.mjs';
import {formatEquivalentCommand} from './command-format.mjs';
import {FILTER_IDS, normalizeFilterId} from './filters.mjs';

const LEGACY_JSON = ['beats.json', 'lyrics.json', 'analysis.json', 'timeline.json'];
const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const AUDIO_EXTS = new Set(['.mp3', '.m4a', '.wav', '.flac', '.aac', '.ogg']);
const LYRIC_EXTS = new Set(['.lrc']);
// 视频素材暂不支持;单列出来让调用方显式提醒,而不是静默忽略
const VIDEO_EXTS = new Set(['.mp4', '.mov', '.avi', '.mkv', '.webm', '.m4v']);
export const AUDIO_DIR = 'audio';

// 符号链接按跟随后的真实类型归类:指向目录的链接(哪怕扩展名像图片)不算文件,
// 悬空/循环链接跳过 —— 否则它们会被算成照片,在读取时以 EISDIR/ENOENT 崩溃.
const isReadableFile = (folder, entry) => {
  if (entry.isFile()) return true;
  if (!entry.isSymbolicLink()) return false;
  try {
    return fs.statSync(path.join(folder, entry.name)).isFile();
  } catch {
    return false;
  }
};

const listFiles = (folder) =>
  fs.readdirSync(folder, {withFileTypes: true})
    .filter((entry) => !entry.name.startsWith('.') && isReadableFile(folder, entry))
    .map((entry) => entry.name);

/**
 * 宽松扫描:只按扩展名分类,不校验数量.fetch 用它判断文件夹缺什么、有什么
 * 可覆盖;严格校验仍由 scanFolder 负责.
 */
export const scanFolderLoose = (folder) => {
  const entries = listFiles(folder);
  const audioFolder = path.join(folder, AUDIO_DIR);
  const nestedEntries = fs.existsSync(audioFolder) && fs.statSync(audioFolder).isDirectory()
    ? listFiles(audioFolder).map((name) => path.posix.join(AUDIO_DIR, name))
    : [];
  const byExt = (files, exts) => files.filter((f) => exts.has(path.extname(f).toLowerCase())).sort();
  return {
    photos: byExt(entries, IMAGE_EXTS),
    audios: byExt([...entries, ...nestedEntries], AUDIO_EXTS),
    lyrics: byExt([...entries, ...nestedEntries], LYRIC_EXTS),
    videos: byExt(entries, VIDEO_EXTS),
  };
};

/**
 * Scan a folder for the photo/audio/lyrics inputs tsuzuri needs.
 * `requirePhotos: false` lets commands that don't render a video (e.g. `lyrics`)
 * reuse the same audio/lrc discovery rules without requiring photos to be present.
 * `videos` lists unsupported video files so callers can warn about them.
 */
export const scanFolder = (folder, {requirePhotos = true} = {}) => {
  const {photos, audios, lyrics, videos} = scanFolderLoose(folder);
  if (audios.length > 1) throw new CliError(`文件夹里有多个音频,只能有一个:\n${audios.join('\n')}`);
  if (audios.length === 0) {
    throw new CliError(
      `没有找到音频文件.目录约定:照片 + 唯一的音频文件(${[...AUDIO_EXTS].join(' ')})` +
      `\n└ 可运行 ${formatEquivalentCommand(['fetch', folder])} 补齐`,
    );
  }
  if (requirePhotos && photos.length === 0) {
    throw new CliError(`没有找到图片.目录约定:照片(${[...IMAGE_EXTS].join(' ')})+ 唯一的音频文件`);
  }
  if (lyrics.length > 1) {
    throw new CliError(`文件夹里有多个 LRC 歌词,只能有一个:\n${lyrics.join('\n')}`);
  }
  return {photos, audio: audios[0], lyrics: lyrics[0] ?? null, videos};
};

/**
 * `outputSuffix`(如 `-exif-sign-dark`)只在 `output` 未显式指定时追加到默认
 * 文件名,避免变体覆盖普通版;`-o` 显式指定时用户说了算,不加后缀.
 */
export const resolveProjectPaths = (folder, output = null, outputSuffix = '') => {
  const defaultOutputDir = path.join(folder, 'output');
  const metadataDir = path.join(defaultOutputDir, 'metadata');
  return {
    metadataDir,
    beatsPath: path.join(metadataDir, 'beats.json'),
    lyricsPath: path.join(metadataDir, 'lyrics.json'),
    analysisPath: path.join(metadataDir, 'analysis.json'),
    timelinePath: path.join(metadataDir, 'timeline.json'),
    preferencesPath: path.join(metadataDir, 'preferences.json'),
    outputPath: path.resolve(
      output ?? path.join(defaultOutputDir, `${path.basename(folder)}${outputSuffix}.mp4`),
    ),
  };
};

export const ensureProjectDirs = ({metadataDir, outputPath}) => {
  fs.mkdirSync(metadataDir, {recursive: true});
  fs.mkdirSync(path.dirname(outputPath), {recursive: true});
};

/** Copy legacy root-level JSON once. Originals stay untouched for a safe rollback. */
export const copyLegacyJson = (folder, metadataDir) => {
  const copied = [];
  for (const name of LEGACY_JSON) {
    const source = path.join(folder, name);
    const destination = path.join(metadataDir, name);
    if (fs.existsSync(source) && !fs.existsSync(destination)) {
      fs.copyFileSync(source, destination);
      copied.push(name);
    }
  }
  return copied;
};

/** Copy an older metadata/ directory only into a fresh output/metadata/ directory. */
export const copyLegacyMetadata = (folder, metadataDir) => {
  const legacyDir = path.join(folder, 'metadata');
  if (!fs.existsSync(legacyDir) || !fs.statSync(legacyDir).isDirectory()) return false;
  if (fs.readdirSync(metadataDir).length > 0) return false;
  for (const entry of fs.readdirSync(legacyDir)) {
    fs.cpSync(path.join(legacyDir, entry), path.join(metadataDir, entry), {
      recursive: true,
      force: false,
      errorOnExist: false,
    });
  }
  return true;
};

export const readTrimPreference = (preferencesPath) => {
  try {
    const preference = JSON.parse(fs.readFileSync(preferencesPath, 'utf8'));
    return preference?.version === 1 && ['auto', 'full'].includes(preference.trim)
      ? preference.trim
      : null;
  } catch {
    return null;
  }
};

export const writeTrimPreference = (preferencesPath, value) => {
  if (!['auto', 'full'].includes(value)) throw new TypeError(`不支持的 trim 偏好: ${value}`);
  fs.mkdirSync(path.dirname(preferencesPath), {recursive: true});
  fs.writeFileSync(preferencesPath, `${JSON.stringify({version: 1, trim: value}, null, 2)}\n`, 'utf8');
};

/**
 * 输入素材是否变化的摘要,供 plan.py 判断时间线要不要重建.
 * 用 size + mtimeNs 元数据代替全量读文件:写入必然更新 mtime,真实修改
 * 都会被检出;代价是"改了内容又精确恢复 mtime+size"的刻意伪造检测不到,
 * 对本地素材改动检测这是可接受的取舍 —— 全量读哈希在大照片集下要同步读
 * 数十 GB,缓存命中与否都得付.
 */
export const computeInputHash = (folder, files) => {
  const hash = createHash('sha256');
  for (const file of [...files].sort()) {
    // mtimeNs 只在 bigint stat 上有;普通 stat 只有 mtimeMs,同一毫秒内的
    // 连续写入会撞出相同的摘要,纳秒级才可靠.
    const {size, mtimeNs} = fs.statSync(path.join(folder, file), {bigint: true});
    hash.update(`${file}\0${size}:${mtimeNs}\0`);
  }
  return hash.digest('hex').slice(0, 16);
};

const trimKeyPattern = /^\s*(?:trim|"trim"|'trim')\s*=/;

export const hasExplicitTrimConfig = (folder) => {
  const tomlPath = path.join(folder, 'tsuzuri.toml');
  if (!fs.existsSync(tomlPath)) return false;
  return fs.readFileSync(tomlPath, 'utf8').split(/\r?\n/).some((line) => trimKeyPattern.test(line));
};

const isValidIntensity = (value) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;

/**
 * 素材夹逐张滤镜偏好:`<folder>/tsuzuri.json`,结构
 * `{ filter?, intensity?, perPhoto?: { "<照片文件名>": { filter?, intensity? } } }`.
 * tsuzuri.toml 是画布用的扁平配置,不适合嵌套的 perPhoto 结构,故用独立 JSON 文件.
 * 文件不存在时返回 null;字段非法时抛 CliError,便于用户第一时间发现拼写错误.
 */
export const readFilterConfig = (folder) => {
  const jsonPath = path.join(folder, 'tsuzuri.json');
  if (!fs.existsSync(jsonPath)) return null;
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  } catch {
    throw new CliError(`tsuzuri.json 不是合法 JSON: ${jsonPath}`);
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new CliError(`tsuzuri.json 顶层必须是对象: ${jsonPath}`);
  }
  const config = {};
  if (raw.filter !== undefined) {
    const filter = normalizeFilterId(raw.filter);
    if (!filter) {
      throw new CliError(`tsuzuri.json 里 filter 未知滤镜 id: ${raw.filter}(可选: ${FILTER_IDS.join(', ')})`);
    }
    config.filter = filter;
  }
  if (raw.intensity !== undefined) {
    if (!isValidIntensity(raw.intensity)) {
      throw new CliError(`tsuzuri.json 里 intensity 需要 0–1 之间的数字,收到 ${raw.intensity}`);
    }
    config.intensity = raw.intensity;
  }
  if (raw.perPhoto !== undefined) {
    if (typeof raw.perPhoto !== 'object' || raw.perPhoto === null || Array.isArray(raw.perPhoto)) {
      throw new CliError(`tsuzuri.json 里 perPhoto 必须是对象: ${jsonPath}`);
    }
    const perPhoto = {};
    for (const [photoName, entry] of Object.entries(raw.perPhoto)) {
      if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
        throw new CliError(`tsuzuri.json 里 perPhoto.${photoName} 必须是对象`);
      }
      const photoConfig = {};
      if (entry.filter !== undefined) {
        const filter = normalizeFilterId(entry.filter);
        if (!filter) {
          throw new CliError(`tsuzuri.json 里 perPhoto.${photoName}.filter 未知滤镜 id: ${entry.filter}(可选: ${FILTER_IDS.join(', ')})`);
        }
        photoConfig.filter = filter;
      }
      if (entry.intensity !== undefined) {
        if (!isValidIntensity(entry.intensity)) {
          throw new CliError(`tsuzuri.json 里 perPhoto.${photoName}.intensity 需要 0–1 之间的数字,收到 ${entry.intensity}`);
        }
        photoConfig.intensity = entry.intensity;
      }
      perPhoto[photoName] = photoConfig;
    }
    config.perPhoto = perPhoto;
  }
  return config;
};

/**
 * 照片文件名变更时同步 tsuzuri.json 的 perPhoto 键.先完整校验旧配置,再用同目录
 * 临时文件替换;调用方若随后文件移动失败,可以把 returned raw 写回去回滚.
 */
export const renamePerPhotoConfig = (folder, fromName, toName) => {
  const jsonPath = path.join(folder, 'tsuzuri.json');
  if (!fs.existsSync(jsonPath) || fromName === toName) return null;
  const rawText = fs.readFileSync(jsonPath, 'utf8');
  const config = readFilterConfig(folder);
  if (!config?.perPhoto || !Object.prototype.hasOwnProperty.call(config.perPhoto, fromName)) return null;
  if (Object.prototype.hasOwnProperty.call(config.perPhoto, toName)) {
    throw new CliError(`tsuzuri.json 的 perPhoto 已有目标照片配置: ${toName}`);
  }
  const raw = JSON.parse(rawText);
  raw.perPhoto[toName] = raw.perPhoto[fromName];
  delete raw.perPhoto[fromName];
  const temporary = `${jsonPath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(raw, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, jsonPath);
  return {jsonPath, rawText};
};

/**
 * 优先级:CLI flag > perPhoto > 配置全局 > 无.
 * cliFilter 非空时对所有照片一视同仁(渲染/still 全局 --filter 语义不变).
 */
export const resolveFilterForPhoto = ({config = null, cliFilter = null, photoName}) => {
  if (cliFilter) return cliFilter;
  const perPhotoEntry = config?.perPhoto?.[photoName];
  const id = perPhotoEntry?.filter ?? config?.filter;
  if (!id) return null;
  const intensity = perPhotoEntry?.intensity ?? config?.intensity;
  return {id, ...(intensity !== undefined ? {intensity} : {})};
};
