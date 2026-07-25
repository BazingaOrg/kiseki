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
}

/** 与 renderer/src/theme.ts 的 SUBTITLE.confidenceThreshold 保持一致 */
export const RENDER_CONFIDENCE_THRESHOLD = 0.6;

export interface ProjectResponse {
  path: string;
  name: string;
  /** 沙箱根。等于 path 时说明启动时锁定了素材夹,页面里换不了 */
  root: string;
  photos: string[];
  audio: string | null;
  audioCount: number;
  lyricsFile: string | null;
  lyricsCount: number;
  lyrics: LyricLine[] | null;
  /** 歌词来自用户自备的 .lrc,还是本地识别的产物 */
  lyricsSource: 'lrc' | 'recognized' | null;
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
 */
export interface AudioCandidate {
  id: string;
  title: string;
  duration: string | number | null;
  uploader: string;
}

/** LRCLIB 搜索结果(GET /api/fetch/lyrics-search)。delta 是与本地音频的时长差(秒)。 */
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
