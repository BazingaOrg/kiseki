import type {AudioCandidate, LyricsCandidate, LyricsValidation} from './types';

export type ApiResult<T> =
  | {ok: true; data: T}
  | {ok: false; message: string; /** 可复制的补救文案,如安装命令 */ fix: string | null; recoveryUndoId?: string; recoveryRequired?: boolean};

/** 读取页面启动时注入的请求令牌。会启动进程或写文件的端点必须携带它。 */
export const getToken = (): string =>
  document.querySelector('meta[name="kiseki-token"]')?.getAttribute('content') ?? '';

const readFailure = async (res: Response): Promise<Extract<ApiResult<never>, {ok: false}>> => {
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
    const res = await fetch(url, {headers: {'X-Kiseki-Token': getToken()}});
    if (!res.ok) return await readFailure(res);
    return {ok: true, data: (await res.json()) as T};
  } catch {
    return {ok: false, message: '连不上 kiseki 服务，确认它还在跑。', fix: null};
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
      headers: {'Content-Type': 'application/json', 'X-Kiseki-Token': getToken()},
      body: JSON.stringify({folder, id, offset}),
    });
    if (!res.ok) return await readFailure(res);
    return {ok: true, data: (await res.json()) as {file: string}};
  } catch {
    return {ok: false, message: '连不上 kiseki 服务，确认它还在跑。', fix: null};
  }
};

const postAsset = async <T>(url: string, body: object): Promise<ApiResult<T>> => {
  try {
    const res = await fetch(url, {method: 'POST', headers: {'Content-Type': 'application/json', 'X-Kiseki-Token': getToken()}, body: JSON.stringify(body)});
    if (!res.ok) return await readFailure(res);
    return {ok: true, data: (await res.json()) as T};
  } catch { return {ok: false, message: '连不上 kiseki 服务，确认它还在跑。', fix: null}; }
};

export const validateLyrics = (folder: string, id: LyricsCandidate['id']) =>
  postAsset<LyricsValidation>('/api/fetch/lyrics-validate', {folder, id});

export const mutateAsset = (folder: string, assetId: string, action: 'rename' | 'delete', stem?: string) =>
  postAsset<{assetId?: string; name?: string; undoId?: string}>('/api/assets/mutate', {folder, assetId, action, stem});

export const undoAssetDelete = (folder: string, undoId: string) =>
  postAsset<{restored: number}>('/api/assets/undo', {folder, undoId});

export const clearRecognizedLyrics = (folder: string) =>
  postAsset<{undoId: string}>('/api/assets/recognized-lyrics/clear', {folder});
