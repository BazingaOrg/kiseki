import {normalizeFilterId} from './filters.mjs';
import {resolveFilterForPhoto} from './project.mjs';

const SAFE_SUFFIX = /^[a-z0-9.-]+$/;

/**
 * The renderer's default intensity is deliberately not represented here:
 * output names only record an intensity an input source explicitly supplied.
 */
export const normalizeFilterIntensity = (value) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) return null;
  const normalized = String(value);
  return SAFE_SUFFIX.test(normalized) ? normalized : null;
};

const describeFilter = (filter) => {
  const id = normalizeFilterId(filter?.id);
  if (!id) return null;
  const intensity = filter?.intensity === undefined ? null : normalizeFilterIntensity(filter.intensity);
  return intensity === null ? id : `${id}-${intensity}`;
};

/**
 * A CLI/Web filter overrides every photo, so it has a single compact suffix.
 * Project config can intentionally vary per photo; retain every effective
 * canonical parameter set in sorted order so it cannot overwrite another
 * configuration's default output.
 */
export const resolveFilterOutputSuffix = ({filter = null, filterConfig = null, photoNames = []} = {}) => {
  if (filter) {
    const descriptor = describeFilter(filter);
    return descriptor ? `-${descriptor}` : '';
  }

  const descriptors = new Set();
  for (const photoName of photoNames) {
    const descriptor = describeFilter(resolveFilterForPhoto({config: filterConfig, photoName}));
    if (descriptor) descriptors.add(descriptor);
  }
  const values = [...descriptors].sort();
  if (values.length === 0) return '';
  return values.length === 1 ? `-${values[0]}` : `-filters-${values.join('-')}`;
};
