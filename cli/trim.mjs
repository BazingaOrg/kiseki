import {hasExplicitTrimConfig, readTrimPreference, resolveProjectPaths, writeTrimPreference} from './project.mjs';
import {withPrompts} from './prompts.mjs';

/** 仅首次自动裁剪且处于交互终端时询问,并把答案持久化. */
export const maybePersistTrimChoice = async (
  {
    folder,
    preferencesPath = resolveProjectPaths(folder).preferencesPath,
    timeline,
    trimOverride = null,
    planOutcome = 'generated',
    interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY),
    promptRunner = withPrompts,
  },
) => {
  const trim = timeline?.meta?.trim;
  if (
    !interactive
    || planOutcome !== 'generated'
    || trimOverride !== null
    || hasExplicitTrimConfig(folder)
    || readTrimPreference(preferencesPath) !== null
    || trim?.mode !== 'auto'
    || trim?.applied !== true
  ) {
    return null;
  }

  const photos = timeline.photos?.filter((clip) => (clip.kind === undefined || clip.kind === 'photo') && typeof clip.src === 'string').length ?? 0;
  const average = photos > 0 ? trim.trimmed_duration / photos : 0;
  const picked = await promptRunner((ask) => ask.pick(
    `歌长图少,已在 ${trim.trimmed_duration.toFixed(1)} 秒重拍处截断(平均每张 ${average.toFixed(1)} 秒).如何处理?`,
    ['接受裁剪', '播完整首歌'],
    {allowBack: false, defaultIndex: 0, enterLabel: '接受裁剪'},
  ));
  const value = picked?.index === 1 ? 'full' : 'auto';
  writeTrimPreference(preferencesPath, value);
  return value;
};
