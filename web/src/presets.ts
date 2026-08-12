/**
 * 用户级"一键组合"预设:模板 + 滤镜 + 暗色等素材基调选项的命名快照,
 * 按素材夹存在 localStorage。模板只负责呈现层,预设负责"整体长什么样"——
 * 两者分层(见 docs/plans/2026-08-07-template-system.md)。
 */
import type {JobOptions} from './useJob.ts';

export interface RenderPreset {
  id: string;
  name: string;
  options: JobOptions;
}

const keyFor = (folder: string) => `kiseki-presets:${folder}`;

export const loadPresets = (folder: string): RenderPreset[] => {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(keyFor(folder));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is RenderPreset =>
      typeof item === 'object' &&
      item !== null &&
      typeof (item as RenderPreset).id === 'string' &&
      typeof (item as RenderPreset).name === 'string' &&
      typeof (item as RenderPreset).options === 'object');
  } catch {
    return [];
  }
};

const persist = (folder: string, presets: RenderPreset[]) => {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(keyFor(folder), JSON.stringify(presets));
  } catch {
    // 隐私模式等写不进 storage 的场景:预设可丢,不影响功能
  }
};

/** 保存一份命名预设;同名覆盖。模板 id 不在注册表里时净化为 null,避免渲染校验失败。 */
export const savePreset = (folder: string, name: string, options: JobOptions, validTemplateIds: string[]): RenderPreset[] => {
  const trimmed = name.trim();
  if (!trimmed) return loadPresets(folder);
  const sanitized = {
    ...options,
    template: options.template && validTemplateIds.includes(options.template) ? options.template : null,
  };
  const next = [...loadPresets(folder).filter((preset) => preset.name !== trimmed), {
    id: crypto.randomUUID(),
    name: trimmed,
    options: sanitized,
  }];
  persist(folder, next);
  return next;
};

export const deletePreset = (folder: string, id: string): RenderPreset[] => {
  const next = loadPresets(folder).filter((preset) => preset.id !== id);
  persist(folder, next);
  return next;
};
