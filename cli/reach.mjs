export const YOUTUBE_REACH_URL = 'https://www.youtube.com/generate_204';
export const LRCLIB_REACH_URL = 'https://lrclib.net';

export const canReach = async (url, {timeoutMs = 4000, fetchImpl = globalThis.fetch} = {}) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {'user-agent': 'kiseki'},
    });
    return Boolean(response) && response.status >= 200 && response.status < 400;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
};
