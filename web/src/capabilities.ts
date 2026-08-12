/** 从项目与环境状态派生所有能力门禁，避免组件各自维护依赖规则。 */
import type {DoctorState, ProjectResponse} from './types';

export type CapabilityId =
  | 'browsePhotos'
  | 'followLyrics'
  | 'playVideo'
  | 'renderVideo'
  | 'exportStill'
  | 'recognizeLyrics'
  | 'fetchAudio'
  | 'fetchLyrics';

export interface Remedy {
  label: string;
  /** 跳到某个区段,或打开环境面板 */
  target: 'materials' | 'make' | 'doctor';
}

export interface Blocker {
  reason: string;
  remedy: Remedy | null;
}

export interface Capability {
  enabled: boolean;
  blockers: Blocker[];
}

export type Capabilities = Record<CapabilityId, Capability>;

const MATERIALS: Remedy = {label: '去补素材', target: 'materials'};
const MAKE: Remedy = {label: '去制作', target: 'make'};
const DOCTOR: Remedy = {label: '查看环境', target: 'doctor'};

/**
 * 依赖类 blocker。三态各有各的处理:
 *   'loading'     —— 还没查完,暂不判定(否则开局一瞬间满屏禁用)
 *   'unavailable' —— 查不了(接口挂了/网络断了)。**必须挡住** ——
 *                    这时候还说"素材齐了，可以开工"就是在骗人
 *   实际结果       —— 按 ok 判定
 */
const depBlocker = (doctor: DoctorState, id: string, what: string): Blocker | null => {
  if (doctor === 'loading') return null;
  if (doctor === 'unavailable') {
    return {reason: '环境检查没能完成，暂时说不准能不能开工。', remedy: DOCTOR};
  }
  if (doctor.checks.some((check) => check.id === id && check.ok)) return null;
  return {reason: `${what}需要 ${id}，现在还没装好。`, remedy: DOCTOR};
};

const dedupeBlockers = (blockers: Blocker[]): Blocker[] => {
  const seen = new Set<string>();
  return blockers.filter((blocker) => {
    if (seen.has(blocker.reason)) return false;
    seen.add(blocker.reason);
    return true;
  });
};

const compact = (blockers: (Blocker | null)[]): Blocker[] =>
  blockers.filter((blocker): blocker is Blocker => blocker !== null);

const make = (blockers: (Blocker | null)[]): Capability => {
  const list = dedupeBlockers(compact(blockers));
  return {enabled: list.length === 0, blockers: list};
};

/**
 * @param project 已选中的素材夹;null 表示还没选 —— 此时除环境检查外一切不可用
 * @param doctor 环境依赖状态,见 DoctorState 的三态说明
 */
export const deriveCapabilities = (
  project: ProjectResponse | null,
  doctor: DoctorState,
): Capabilities => {
  const noFolder: Blocker = {reason: '还没有选素材夹。', remedy: null};

  if (project === null) {
    const blocked = make([noFolder]);
    return {
      browsePhotos: blocked,
      followLyrics: blocked,
      playVideo: blocked,
      renderVideo: blocked,
      exportStill: blocked,
      recognizeLyrics: blocked,
      fetchAudio: blocked,
      fetchLyrics: blocked,
    };
  }

  const photoCount = project.photos.length;
  const stillCount = project.output.stills.length;
  const videoCount = project.output.videos.length;
  const hasAudio = project.audio !== null;
  // 后端已把 .lrc 与本地识别产物归一成同一个 lyrics 数组,这里不必再区分来源
  const hasLyricLines = (project.lyrics?.length ?? 0) > 0;

  const noPhotos: Blocker | null =
    photoCount > 0 ? null : {reason: '这个文件夹里还没有照片。', remedy: MATERIALS};
  const noAudio: Blocker | null =
    hasAudio ? null : {reason: '还差一首歌。', remedy: MATERIALS};
  // 多份音频是 scanFolder 会直接报错的歧义状态,提前在网页上拦下来
  const ambiguousAudio: Blocker | null =
    project.audioCount > 1
      ? {reason: `文件夹里有 ${project.audioCount} 份音频，只能留一份。`, remedy: MATERIALS}
      : null;
  const ambiguousLyrics: Blocker | null =
    project.lyricsCount > 1
      ? {reason: `文件夹里有 ${project.lyricsCount} 份歌词，只能留一份。`, remedy: MATERIALS}
      : null;

  return {
    browsePhotos: make([
      photoCount > 0 || stillCount > 0
        ? null
        : {reason: '这个文件夹里既没有照片，也没有导出的静态图。', remedy: MATERIALS},
    ]),

    followLyrics: make([
      noAudio,
      ambiguousLyrics,
      hasLyricLines
        ? null
        : {reason: '还没有歌词。可以放一份 .lrc，也可以让 kiseki 本地识别。', remedy: MATERIALS},
    ]),

    playVideo: make([
      videoCount > 0 ? null : {reason: '还没有渲染好的成片。', remedy: MAKE},
    ]),

    renderVideo: make([
      noPhotos,
      noAudio,
      ambiguousAudio,
      ambiguousLyrics,
      depBlocker(doctor, 'uv', '音频分析'),
      depBlocker(doctor, 'ffmpeg', '视频封装'),
      depBlocker(doctor, 'renderer', '视频渲染'),
    ]),

    // 导出静态图不碰音频,也不需要 uv/ffmpeg —— 只要有照片和渲染器就行
    exportStill: make([noPhotos, depBlocker(doctor, 'renderer', '导出静态图')]),

    // analyzer 用 soundfile 读音频,读不了的容器(.m4a 等)会退回 ffmpeg 解码,
    // 所以歌词识别同样要 ffmpeg —— 见 analyzer/analyze.py 的 load_audio
    recognizeLyrics: make([
      noAudio,
      ambiguousAudio,
      ambiguousLyrics,
      depBlocker(doctor, 'uv', '歌词识别'),
      depBlocker(doctor, 'ffmpeg', '音频解码'),
    ]),

    fetchAudio: make([depBlocker(doctor, 'yt-dlp', '在线获取音频')]),

    // 在线找歌词靠音频的标题与时长去匹配,没有音频/音频不唯一就无从找起;
    // 多份歌词时后端 resolveAudioFolder 会 409,这里提前把歧义说清楚
    fetchLyrics: make([
      hasAudio ? null : {reason: '在线找歌词要先有音频，靠它的标题和时长匹配。', remedy: MATERIALS},
      ambiguousAudio,
      ambiguousLyrics,
    ]),
  };
};
