/**
 * EXIF 提取与格式化:CLI 侧产出最终展示字符串,渲染器只做哑展示.
 * 不展示 GPS / 软件 / 白平衡等噪音字段.
 */

import exifr from 'exifr';

/** @typedef {{camera?: string, lens?: string, params?: string[], datetime?: string}} FormattedExif */

const clean = (value) => {
  if (value == null) return null;
  const s = String(value).trim();
  return s.length > 0 ? s : null;
};

/** 相机、镜头或拍摄参数至少一项存在,才足以组成可信的 EXIF 展签. */
export const isDisplayableExif = (formatted) =>
  Boolean(formatted?.camera || formatted?.lens || formatted?.params?.length);

/** Make + Model,去掉 Model 里重复的 Make 前缀,简单大小写保留原样. */
export const formatCamera = (make, model) => {
  const m = clean(make);
  const mod = clean(model);
  if (!m && !mod) return undefined;
  if (!m) return mod;
  if (!mod) return m;
  // Model 常以 Make 开头(如 "Sony" + "Sony α7 IV")
  const makeRe = new RegExp(`^${m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+`, 'i');
  if (makeRe.test(mod)) return mod;
  return `${m} ${mod}`;
};

export const formatLens = (lensModel) => clean(lensModel) ?? undefined;

/** 快门:优先分数 1/N,否则秒数. */
export const formatExposure = (exposureTime) => {
  if (exposureTime == null || !Number.isFinite(Number(exposureTime))) return null;
  const t = Number(exposureTime);
  if (t <= 0) return null;
  if (t >= 1) {
    const rounded = Number.isInteger(t) ? String(t) : t.toFixed(1).replace(/\.0$/, '');
    return `${rounded}s`;
  }
  const denom = Math.round(1 / t);
  if (denom > 0 && Math.abs(1 / denom - t) / t < 0.05) {
    return `1/${denom}s`;
  }
  return `${t.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')}s`;
};

export const formatFocal = (focalLength) => {
  if (focalLength == null || !Number.isFinite(Number(focalLength))) return null;
  const n = Number(focalLength);
  if (n <= 0) return null;
  return `${Math.round(n)}mm`;
};

export const formatAperture = (fNumber) => {
  if (fNumber == null || !Number.isFinite(Number(fNumber))) return null;
  const n = Number(fNumber);
  if (n <= 0) return null;
  const s = Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, '');
  return `f/${s}`;
};

export const formatIso = (iso) => {
  if (iso == null) return null;
  const n = Number(iso);
  if (!Number.isFinite(n) || n <= 0) return null;
  return `ISO ${Math.round(n)}`;
};

export const formatParams = ({focalLength, fNumber, exposureTime, iso}) => {
  const parts = [
    formatFocal(focalLength),
    formatAperture(fNumber),
    formatExposure(exposureTime),
    formatIso(iso),
  ].filter(Boolean);
  return parts.length > 0 ? parts : undefined;
};

/** EXIF DateTimeOriginal: "2026:05:21 18:42:33" → "2026.05.21 18:42" */
export const formatDatetime = (value) => {
  if (value == null) return undefined;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const y = value.getFullYear();
    const mo = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    const h = String(value.getHours()).padStart(2, '0');
    const mi = String(value.getMinutes()).padStart(2, '0');
    return `${y}.${mo}.${d} ${h}:${mi}`;
  }
  const s = clean(value);
  if (!s) return undefined;
  // 常见 EXIF 字符串
  const m = s.match(/^(\d{4})[:\-/](\d{2})[:\-/](\d{2})[ T](\d{2}):(\d{2})/);
  if (m) return `${m[1]}.${m[2]}.${m[3]} ${m[4]}:${m[5]}`;
  return s;
};

/**
 * 从照片文件提取并格式化四行 EXIF.失败或全缺返回 null(调用方回退无 EXIF 布局).
 * @param {string} filePath
 * @returns {Promise<FormattedExif | null>}
 */
export const extractFormattedExif = async (filePath) => {
  let raw;
  try {
    raw = await exifr.parse(filePath, {
      // 明确不取 GPS
      gps: false,
      pick: [
        'Make',
        'Model',
        'LensModel',
        'FocalLength',
        'FNumber',
        'ExposureTime',
        'ISO',
        'ISOSpeedRatings',
        'PhotographicSensitivity',
        'DateTimeOriginal',
        'CreateDate',
      ],
    });
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;

  const iso = raw.ISO ?? raw.ISOSpeedRatings ?? raw.PhotographicSensitivity;
  const formatted = {
    camera: formatCamera(raw.Make, raw.Model),
    lens: formatLens(raw.LensModel),
    params: formatParams({
      focalLength: raw.FocalLength,
      fNumber: raw.FNumber,
      exposureTime: raw.ExposureTime,
      iso,
    }),
    datetime: formatDatetime(raw.DateTimeOriginal ?? raw.CreateDate),
  };

  // 时间单独存在时可能只是转存/保存时间,不足以组成可靠展签.
  if (!isDisplayableExif(formatted)) {
    return null;
  }
  // 去掉 undefined 键,props 更干净
  return Object.fromEntries(Object.entries(formatted).filter(([, v]) => v != null));
};
