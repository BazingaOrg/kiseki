import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import {CliError} from './options.mjs';
import {formatEquivalentCommand} from './command-format.mjs';

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
 * Scan a folder for the photo/audio/lyrics inputs kiseki needs.
 * `requirePhotos: false` lets commands that don't render a video (e.g. `lyrics`)
 * reuse the same audio/lrc discovery rules without requiring photos to be present.
 * `videos` lists unsupported video files so callers can warn about them.
 */
export const scanFolder = (folder, {requirePhotos = true, requireAudio = true} = {}) => {
  const {photos, audios, lyrics, videos} = scanFolderLoose(folder);
  if (audios.length > 1) throw new CliError(`文件夹里有多个音频,只能有一个:\n${audios.join('\n')}`);
  if (requireAudio && audios.length === 0) {
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
  return {photos, audio: audios[0] ?? null, lyrics: lyrics[0] ?? null, videos};
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
  const tomlPath = path.join(folder, 'kiseki.toml');
  if (!fs.existsSync(tomlPath)) return false;
  return fs.readFileSync(tomlPath, 'utf8').split(/\r?\n/).some((line) => trimKeyPattern.test(line));
};
