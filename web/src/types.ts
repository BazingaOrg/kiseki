export interface DirEntry {
  name: string;
  path: string;
  isProject: boolean;
}

export interface DirsResponse {
  path: string;
  parent: string | null;
  dirs: DirEntry[];
  root: string;
}

export interface LyricLine {
  time: number;
  text: string;
  /** 只有本地识别的歌词才有;低于渲染阈值的行成片里不会显示字幕 */
  confidence?: number | null;
  /** 这一句到点该收了(来自 .lrc 里只有时间戳的空行)。null 表示一直显示到下一句 */
  until?: number | null;
}

/** 与 renderer/src/theme.ts 的 SUBTITLE.confidenceThreshold 保持一致 */
export const RENDER_CONFIDENCE_THRESHOLD = 0.6;

export type AssetKind = 'photo' | 'audio' | 'lyrics' | 'still' | 'video';
export type AssetOrigin = 'source' | 'output';
export type AssetState = 'empty' | 'ready' | 'ambiguous';

/** /api/project 的只读资产项。id 由当前路径派生，改名后会变化。 */
export interface AssetItem {
  id: string;
  kind: AssetKind;
  origin: AssetOrigin;
  name: string;
  path: string;
  preview: {type: 'image'; path: string} | null;
  /** 独立 LRC 仅展示，不能单独改变其与音频的配对关系。 */
  manageable?: boolean;
  actionHint?: string | null;
}

export interface AssetCollection {
  kind: AssetKind;
  origin: AssetOrigin;
  items: AssetItem[];
  /** 只有唯一候选才有主资产；多份文件必须由后续选择流程处理。 */
  primaryId: string | null;
  state: AssetState;
}

export interface ProjectResponse {
  path: string;
  name: string;
  /** 沙箱根。等于 path 时说明启动时锁定了素材夹,页面里换不了 */
  root: string;
  photos: string[];
  audio: string | null;
  audioCount: number;
  /** 新版 /api/project 的全量音频；可选仅用于兼容旧的测试夹具与旧服务端。 */
  audios?: string[];
  lyricsFile: string | null;
  lyricsCount: number;
  /** 新版 /api/project 的全量歌词文件；可选仅用于兼容旧的测试夹具与旧服务端。 */
  lyricsFiles?: string[];
  assets?: {
    photos: AssetCollection;
    audios: AssetCollection;
    lyrics: AssetCollection;
    stills: AssetCollection;
    videos: AssetCollection;
  };
  lyrics: LyricLine[] | null;
  /** 歌词来自用户自备的 .lrc,还是本地识别的产物 */
  lyricsSource: 'lrc' | 'recognized' | null;
  /** 只有无任何物理 LRC 且识别 JSON 可用时才能重新识别或清除。 */
  recognizedLyricsManageable?: boolean;
  /** output/metadata/lyrics.json —— 识别过的产物是否存在 */
  recognizedLyricsPath: string | null;
  /** output/metadata/timeline.json —— 规划过时间线,说明这个素材夹渲染过 */
  timelinePath: string | null;
  unsupportedVideos: string[];
  filterConfig: unknown;
  output: {
    stills: string[];
    videos: string[];
  };
}

export interface DoctorCheck {
  id: string;
  ok: boolean;
  optional: boolean;
  line: string;
  fix: string | null;
}

export interface DoctorResponse {
  ok: boolean;
  checks: DoctorCheck[];
}

/**
 * 环境检查的三态。'loading' 与 'unavailable' 必须分开:两者都"没有依赖数据",
 * 但前者只是还没查完(不该判死),后者是查不了(不能再声称"可以开工")。
 */
export type DoctorState = DoctorResponse | 'loading' | 'unavailable';

/**
 * yt-dlp 搜索结果(GET /api/fetch/audio-search)。
 * duration 是 yt-dlp 的 `duration_string`(如 "3:45");按秒给也认,见 candidateDuration。
 * 服务端按来源顺序以稳定 id 去重后最多返回 10 条；uploader 仅供展示，不参与落盘命名。
 */
export interface AudioCandidate {
  id: string;
  title: string;
  duration: string | number | null;
  uploader: string;
}

/** LRCLIB 搜索结果(GET /api/fetch/lyrics-search)。delta 是与本地音频的时长差(秒)，列表最多 10 条。 */
export interface LyricsCandidate {
  id: string | number;
  title: string;
  artist: string;
  duration: number | null;
  delta: number | null;
  synced: boolean;
}

export interface ExifData {
  camera?: string;
  lens?: string;
  params?: string[];
  datetime?: string;
}

export interface ExifResponse {
  path: string;
  exif: ExifData | null;
  displayable: boolean;
}
