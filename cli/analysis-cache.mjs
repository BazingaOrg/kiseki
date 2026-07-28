import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const ANALYSIS_CACHE_VERSION = 2;

const parseRuntimeFingerprint = (fingerprint) => {
  try {
    const value = typeof fingerprint === 'string' ? JSON.parse(fingerprint) : fingerprint;
    if (
      value?.version !== 1 ||
      !Number.isInteger(value.beat_features_version) ||
      value.beat_features_version < 1 ||
      !['mlx', 'cuda', 'cpu'].includes(value.backend) ||
      typeof value.model !== 'string' ||
      value.model.length === 0 ||
      typeof value.demucs_available !== 'boolean'
    ) {
      return null;
    }
    return {
      version: value.version,
      beat_features_version: value.beat_features_version,
      backend: value.backend,
      model: value.model,
      demucs_available: value.demucs_available,
    };
  } catch {
    return null;
  }
};

export const readAnalysisFingerprint = (analyzer, spawn = spawnSync) => {
  const result = spawn(
    'uv',
    ['run', '--project', analyzer, 'tsuzuri-analysis-fingerprint'],
    {encoding: 'utf8'},
  );
  if (result.error || result.status !== 0) return null;
  const value = parseRuntimeFingerprint(result.stdout);
  return value === null ? null : JSON.stringify(value);
};

const demucsKeyPattern = /^\s*(?:demucs|"demucs"|'demucs')\s*=/;
const demucsValuePattern = /^\s*(?:demucs|"demucs"|'demucs')\s*=\s*(true|false)\s*(?:#.*)?$/;

/** 只读取 analyzer 消费的 flat TOML 布尔键；可疑配置返回 null，保守禁用缓存。 */
export const readDemucsSetting = (folder) => {
  const tomlPath = path.join(folder, 'tsuzuri.toml');
  if (!fs.existsSync(tomlPath)) return true;
  const matches = [];
  for (const line of fs.readFileSync(tomlPath, 'utf8').split(/\r?\n/)) {
    if (!demucsKeyPattern.test(line)) continue;
    const match = line.match(demucsValuePattern);
    if (!match) return null;
    matches.push(match[1] === 'true');
  }
  return matches.length === 0 ? true : matches.length === 1 ? matches[0] : null;
};

export const computeAnalysisHash = (
  folder,
  {audio, lyrics = null, runtimeFingerprint = null},
) => {
  const demucs = readDemucsSetting(folder);
  const runtime = parseRuntimeFingerprint(runtimeFingerprint);
  if (demucs === null || runtime === null) return null;
  const runtimeProjection = lyrics
    ? {
        version: runtime.version,
        beat_features_version: runtime.beat_features_version,
      }
    : demucs
      ? runtime
      : {
          version: runtime.version,
          beat_features_version: runtime.beat_features_version,
          backend: runtime.backend,
          model: runtime.model,
        };
  const hash = createHash('sha256');
  hash.update(`analysis-v${ANALYSIS_CACHE_VERSION}\0`);
  for (const file of [audio, lyrics].filter(Boolean).sort()) {
    hash.update(`${file}\0`);
    hash.update(fs.readFileSync(path.join(folder, file)));
  }
  hash.update(`runtime\0${JSON.stringify(runtimeProjection)}`);
  return hash.digest('hex').slice(0, 16);
};

const validJsonArtifact = (file) => {
  if (!fs.existsSync(file)) return false;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))?.version === 1;
  } catch {
    return false;
  }
};

export const hasValidAnalysisCache = ({analysisPath, beatsPath, lyricsPath, audioHash}) => {
  if (audioHash === null || !validJsonArtifact(beatsPath) || !validJsonArtifact(lyricsPath)) {
    return false;
  }
  try {
    const manifest = JSON.parse(fs.readFileSync(analysisPath, 'utf8'));
    return manifest?.version === ANALYSIS_CACHE_VERSION && manifest.audio_hash === audioHash;
  } catch {
    return false;
  }
};

export const invalidateAnalysisManifest = (analysisPath) => {
  fs.rmSync(analysisPath, {force: true});
};

export const writeAnalysisManifest = ({analysisPath, beatsPath, lyricsPath, audioHash}) => {
  if (audioHash === null) {
    invalidateAnalysisManifest(analysisPath);
    return false;
  }
  if (!validJsonArtifact(beatsPath) || !validJsonArtifact(lyricsPath)) {
    throw new Error('音频分析完成但生成的 beats.json / lyrics.json 无效');
  }
  const tmp = `${analysisPath}.${process.pid}.tmp`;
  fs.writeFileSync(
    tmp,
    `${JSON.stringify({version: ANALYSIS_CACHE_VERSION, audio_hash: audioHash}, null, 2)}\n`,
    'utf8',
  );
  fs.renameSync(tmp, analysisPath);
  return true;
};
