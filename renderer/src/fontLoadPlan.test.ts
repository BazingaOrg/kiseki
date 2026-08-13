import assert from 'node:assert/strict';
import test from 'node:test';

import {FONT_LOAD_PLAN} from './fontLoadPlan.ts';

test('each template family loads three faces and never the other family', () => {
  const serif = FONT_LOAD_PLAN.serif.map((spec) => spec.family);
  const sans = FONT_LOAD_PLAN.sans.map((spec) => spec.family);
  assert.deepEqual(serif, ['Noto Serif JP', 'Noto Serif SC', 'Noto Serif']);
  assert.deepEqual(sans, ['Noto Sans JP', 'Noto Sans SC', 'Noto Sans']);
  assert.equal(new Set([...serif, ...sans]).size, 6);
  assert.ok(FONT_LOAD_PLAN.serif.every((spec) => spec.format === 'truetype-variations'));
  assert.ok(FONT_LOAD_PLAN.sans.every((spec) => spec.format === 'woff2-variations'));
});
