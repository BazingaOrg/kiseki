/** 汇总素材夹清单与产物；EXIF 保持按需读取，避免拖慢目录切换。 */
import fs from 'node:fs';
import path from 'node:path';

import {readFilterConfig, resolveProjectPaths, scanFolderLoose} from '../project.mjs';
import {parseLrc} from '../lrc.mjs';
import {readUsableRecognizedLyrics} from '../recognized-lyrics.mjs';
import {resolveSafePath} from './sandbox.mjs';

const VIDEO_EXTS = new Set(['.mp4', '.mov', '.avi', '.mkv', '.webm', '.m4v']);
const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp']);

const assetItem = ({kind, origin, folder, relativePath, manageable = true, actionHint = null}) => {
  const assetPath = path.join(folder, relativePath);
  return {
    id: `${kind}:${relativePath}`,
    kind,
    origin,
    name: path.basename(relativePath),
    path: assetPath,
    preview: kind === 'photo' || kind === 'still' ? {type: 'image', path: assetPath} : null,
    manageable,
    actionHint,
  };
};

const assetCollection = ({kind, origin, folder, relativePaths}) => {
  const items = relativePaths.map((relativePath) => {
    return assetItem({kind, origin, folder, relativePath});
  });
  return {
    kind,
    origin,
    items,
    primaryId: items.length === 1 ? items[0].id : null,
    state: items.length === 0 ? 'empty' : items.length === 1 ? 'ready' : 'ambiguous',
  };
};

/**
 * 把 keepGaps 解析出来的空文本行折叠成上一句的 `until`,自己不出现在结果里.
 * 前端据此知道"这一句到点该收了",间奏期间不再有行被高亮.
 * @param {{time: number, text: string}[]} entries
 * @returns {{time: number, text: string, until: number|null}[]}
 */
export const withGapEnds = (entries) => {
  const out = [];
  for (const entry of entries) {
    if (entry.text) {
      out.push({time: entry.time, text: entry.text, until: null});
      continue;
    }
    // 空行:标记上一句的结束.开头就是空行则无事可做.
    if (out.length > 0) out[out.length - 1].until = entry.time;
  }
  return out;
};

const listOutputFiles = (outputDir, exts) => {
  if (!fs.existsSync(outputDir)) return [];
  try {
    return fs.readdirSync(outputDir, {withFileTypes: true})
      .filter((entry) => entry.isFile() && !entry.name.startsWith('.tsuzuri-partial-') && exts.has(path.extname(entry.name).toLowerCase()))
      .map((entry) => path.join(outputDir, entry.name))
      .sort();
  } catch {
    return [];
  }
};

/**
 * @param {string} root 允许访问的根目录
 * @param {string} requestedPath 素材夹绝对路径
 * @returns {{status: number, body: object}}
 */
export const getProject = (root, requestedPath) => {
  const safePath = resolveSafePath(root, requestedPath);
  if (!safePath) return {status: 403, body: {error: '路径越界或无效'}};
  let stat;
  try {
    stat = fs.statSync(safePath);
  } catch {
    return {status: 404, body: {error: '路径不存在'}};
  }
  if (!stat.isDirectory()) return {status: 400, body: {error: '不是文件夹'}};

  const {photos, audios, lyrics, videos: unsupportedVideos} = scanFolderLoose(safePath);
  const {lyricsPath, timelinePath} = resolveProjectPaths(safePath);

  // 歌词优先用用户自备的 .lrc(手工校对过,最准),没有才退回本地识别的产物.
  // 两者归一成同一个 {time, text}[],前端不必关心来源差异.
  let lyricsEntries = null;
  let lyricsSource = null;
  if (lyrics.length === 1) {
    try {
      // keepGaps:把"只有时间戳没有文本"的行也读进来,转成上一句的 until.
      // 没有它,间奏那十几秒里上一句会一直挂着高亮不消失.
      const parsed = withGapEnds(parseLrc(fs.readFileSync(path.join(safePath, lyrics[0]), 'utf8'), {keepGaps: true}));
      // 只在真解析出行时才认作歌词来源.空文件、或只有 [ti:]/[ar:] 标签的 .lrc
      // 会让 parseLrc 返回 [],若把它当成"有 .lrc"就会永久遮蔽已识别的歌词
      if (parsed.length > 0) {
        lyricsEntries = parsed;
        lyricsSource = 'lrc';
      }
    } catch {
      lyricsEntries = null;
    }
  }
  if (lyricsEntries === null && lyrics.length === 0) {
    try {
      const recognized = readUsableRecognizedLyrics(lyricsPath);
      const segments = recognized?.segments ?? [];
      const normalized = segments
        .filter((segment) => typeof segment?.start === 'number' && typeof segment?.text === 'string')
        .map((segment) => ({
          time: segment.start,
          text: segment.text.trim(),
          confidence: typeof segment.confidence === 'number' ? segment.confidence : null,
        }))
        // parseLrc 自己会排序,识别产物则原样保留 whisper 的输出顺序;
        // 前端找当前行是"遇到第一个更晚的就停",乱序会让高亮卡住
        .sort((a, b) => a.time - b.time);
      if (normalized.length > 0) {
        lyricsEntries = normalized;
        lyricsSource = 'recognized';
      }
    } catch {
      // 没识别过或文件损坏,歌词就是没有 —— 不阻断其余信息
      lyricsEntries = null;
    }
  }

  let filterConfig = null;
  try {
    filterConfig = readFilterConfig(safePath);
  } catch {
    // tsuzuri.json 非法时不阻断画廊浏览,只是不带滤镜配置回去
    filterConfig = null;
  }

  const outputDir = path.join(safePath, 'output');
  const stills = listOutputFiles(path.join(outputDir, 'stills'), IMAGE_EXTS);
  const exportedVideos = listOutputFiles(outputDir, VIDEO_EXTS);
  const photoAssets = assetCollection({kind: 'photo', origin: 'source', folder: safePath, relativePaths: photos});
  const audioAssets = assetCollection({kind: 'audio', origin: 'source', folder: safePath, relativePaths: audios});
  const lyricsAssets = assetCollection({kind: 'lyrics', origin: 'source', folder: safePath, relativePaths: lyrics});
  const stillAssets = assetCollection({
    kind: 'still',
    origin: 'output',
    folder: safePath,
    relativePaths: stills.map((file) => path.relative(safePath, file)),
  });
  const videoAssets = assetCollection({
    kind: 'video',
    origin: 'output',
    folder: safePath,
    relativePaths: exportedVideos.map((file) => path.relative(safePath, file)),
  });

  const existsFile = (target) => {
    try {
      return fs.statSync(target).isFile();
    } catch {
      return false;
    }
  };

  return {
    status: 200,
    body: {
      path: safePath,
      name: path.basename(safePath),
      // 沙箱根.`tsuzuri web <folder>` 会把根锁定成那个素材夹,此时 root === path,
      // 选择器里除了它自己什么都挑不到 —— 前端据此把"切换素材夹"改成说明,
      // 而不是留一个点了只能选回原地的按钮.
      root: path.resolve(root),
      photos: photos.map((name) => path.join(safePath, name)),
      // 多份音频是 scanFolder 会报错的歧义状态,宽松扫描不报错但要让前端能提示
      audio: audios[0] ? path.join(safePath, audios[0]) : null,
      audioCount: audios.length,
      // 新字段保留全量列表;旧的 audio/lyricsFile/count 字段继续返回,避免旧 Web
      // 客户端在升级期间失效.主资产只会在唯一候选时由 assets.*.primaryId 表示.
      audios: audioAssets.items.map((item) => item.path),
      lyricsFile: lyrics.length === 1 ? path.join(safePath, lyrics[0]) : null,
      lyricsCount: lyrics.length,
      lyricsFiles: lyricsAssets.items.map((item) => item.path),
      assets: {
        photos: photoAssets,
        audios: audioAssets,
        lyrics: lyricsAssets,
        stills: stillAssets,
        videos: videoAssets,
      },
      lyrics: lyricsEntries,
      lyricsSource,
      recognizedLyricsManageable: lyricsSource === 'recognized' && lyrics.length === 0,
      recognizedLyricsPath: existsFile(lyricsPath) ? lyricsPath : null,
      timelinePath: existsFile(timelinePath) ? timelinePath : null,
      unsupportedVideos,
      filterConfig,
      output: {
        stills,
        videos: exportedVideos,
      },
    },
  };
};
