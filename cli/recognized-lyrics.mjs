import fs from 'node:fs';

/** Legacy analyzer segments may omit `end`; project preview has always accepted them. */
export const hasUsableRecognizedLyricsPayload = (payload) =>
  Array.isArray(payload?.segments) && payload.segments.some((segment) =>
    Number.isFinite(segment?.start) && typeof segment?.text === 'string' && segment.text.trim());

export const readUsableRecognizedLyrics = (lyricsPath) => {
  try {
    const payload = JSON.parse(fs.readFileSync(lyricsPath, 'utf8'));
    return hasUsableRecognizedLyricsPayload(payload) ? payload : null;
  } catch { return null; }
};

/** An LRC file is user-owned even if empty or malformed, so it blocks management. */
export const isRecognizedLyricsManageable = ({lyricsPath, lrcFiles}) =>
  Array.isArray(lrcFiles) && lrcFiles.length === 0 && readUsableRecognizedLyrics(lyricsPath) !== null;
