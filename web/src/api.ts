/**
 * 「快操作」端点(批 C 契约):搜索一次 HTTP 往返、落地一次文件写,都在百毫秒级,
 * 不值得进任务系统。分钟级的下载与识别仍走 /api/jobs。
 *
 * 统一返回 ApiResult 而不是抛异常:yt-dlp 没装时后端回 503 并带上安装提示,
 * 那段文案要**原样**给到用户(能复制去粘贴),塞进 Error.message 会丢掉结构。
 */
import type {AudioCandidate, LyricsCandidate, LyricsValidation} from './types';

export type ApiResult<T> =
  | {ok: true; data: T}
  | {ok: false; message: string; /** 可复制的补救文案,如安装命令 */ fix: string | null; recoveryUndoId?: string; recoveryRequired?: boolean};

/**
 * 契约二说 token 只管非 GET,但 /api/fetch/* 这两条 GET 会 spawn 外部进程
 * (yt-dlp / ffprobe / curl),破例也要带 —— Host 校验挡不住任意网页直接请求
 * localhost,不加这道闸一个恶意页面就能无限起进程把机器拖垮。
 */
export const getToken = (): string =>
  document.querySelector('meta[name="tsuzuri-token"]')?.getAttribute('content') ?? '';

const readFailure = async (res: Response): Promise<Extract<ApiResult<never>, {ok: false}>> => {
  // 错误体的字段名契约里没写死,几种常见写法都认一下,认不出至少给个状态码
  const body = (await res.json().catch(() => null)) as
    | {error?: string; message?: string; fix?: string; recoveryUndoId?: string; recoveryRequired?: boolean}
    | null;
  return {
    ok: false,
    message: body?.error ?? body?.message ?? `请求没成功（HTTP ${res.status}）。`,
    fix: body?.fix ?? null,
    recoveryUndoId: body?.recoveryUndoId,
    recoveryRequired: body?.recoveryRequired,
  };
};

const getJson = async <T>(url: string): Promise<ApiResult<T>> => {
  try {
    const res = await fetch(url, {headers: {'X-Tsuzuri-Token': getToken()}});
    if (!res.ok) return await readFailure(res);
    return {ok: true, data: (await res.json()) as T};
  } catch {
    return {ok: false, message: '连不上 tsuzuri 服务，确认它还在跑。', fix: null};
  }
};

export const normalizeSearchQuery = (query: string) => query.trim().replace(/\s+/g, ' ');

export const searchAudio = (query: string): Promise<ApiResult<{candidates: AudioCandidate[]}>> =>
  getJson(`/api/fetch/audio-search?q=${encodeURIComponent(normalizeSearchQuery(query))}`);

/**
 * 不传 query 时后端从音频 tag / 文件名自己推关键词。文件名乱七八糟时那必然猜错,
 * 所以留一个手动覆盖的口子 —— CLI 里也是靠重新输关键词补救的。
 */
export const searchLyrics = (
  folder: string,
  query?: string,
): Promise<ApiResult<{candidates: LyricsCandidate[]; query: string}>> => {
  const params = new URLSearchParams({folder});
  const normalized = query === undefined ? '' : normalizeSearchQuery(query);
  if (normalized) params.set('q', normalized);
  return getJson(`/api/fetch/lyrics-search?${params}`);
};

export const installLyrics = async (
  folder: string,
  id: LyricsCandidate['id'],
  offset = 0,
): Promise<ApiResult<{file: string}>> => {
  try {
    const res = await fetch('/api/fetch/lyrics', {
      method: 'POST',
      headers: {'Content-Type': 'application/json', 'X-Tsuzuri-Token': getToken()},
      body: JSON.stringify({folder, id, offset}),
    });
    if (!res.ok) return await readFailure(res);
    return {ok: true, data: (await res.json()) as {file: string}};
  } catch {
    return {ok: false, message: '连不上 tsuzuri 服务，确认它还在跑。', fix: null};
  }
};

const postAsset = async <T>(url: string, body: object): Promise<ApiResult<T>> => {
  try {
    const res = await fetch(url, {method: 'POST', headers: {'Content-Type': 'application/json', 'X-Tsuzuri-Token': getToken()}, body: JSON.stringify(body)});
    if (!res.ok) return await readFailure(res);
    return {ok: true, data: (await res.json()) as T};
  } catch { return {ok: false, message: '连不上 tsuzuri 服务，确认它还在跑。', fix: null}; }
};

export const validateLyrics = (folder: string, id: LyricsCandidate['id']) =>
  postAsset<LyricsValidation>('/api/fetch/lyrics-validate', {folder, id});

export const mutateAsset = (folder: string, assetId: string, action: 'rename' | 'delete', stem?: string) =>
  postAsset<{assetId?: string; name?: string; undoId?: string}>('/api/assets/mutate', {folder, assetId, action, stem});

export const undoAssetDelete = (folder: string, undoId: string) =>
  postAsset<{restored: number}>('/api/assets/undo', {folder, undoId});

export const clearRecognizedLyrics = (folder: string) =>
  postAsset<{undoId: string}>('/api/assets/recognized-lyrics/clear', {folder});
