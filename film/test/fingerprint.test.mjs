import assert from 'node:assert/strict';
import test from 'node:test';
import {ROLLS, develop} from '../src/index.mjs';
import {chart, flat, meanChroma, meanRgb} from './helpers.mjs';

const colorOnly = (image, roll) => develop(image, {roll, grain: false});
const baseChroma = meanChroma(chart());

for (const roll of ROLLS) {
  test(`${roll.name} behaves like its tags`, () => {
    const graded = colorOnly(chart(), roll.id);
    const chroma = meanChroma(graded) / baseChroma;
    const [r, , b] = meanRgb(colorOnly(flat(128, 128, 128), roll.id));
    if (roll.tags.includes('黑白')) assert.ok(chroma < 0.08, `chroma ${chroma}`);
    else assert.ok(chroma > 0.45, `chroma ${chroma}`);
    if (roll.tags.includes('浓郁')) assert.ok(chroma > 1.05, `chroma ${chroma}`);
    if (roll.tags.includes('暖调')) assert.ok(r - b > 2, `warmth ${r - b}`);
    if (roll.tags.includes('清冷')) assert.ok(b - r > -2, `coolness ${b - r}`);
    if (roll.tags.includes('复古')) {
      const [k] = meanRgb(colorOnly(flat(0, 0, 0), roll.id));
      assert.ok(k > 1.5 || chroma < 0.95, `black ${k} chroma ${chroma}`);
    }
  });
}

test('tags only use the published vocabulary', async () => {
  const {SCENE_TAGS, MOOD_TAGS} = await import('../src/index.mjs');
  const known = new Set([...SCENE_TAGS, ...MOOD_TAGS]);
  for (const roll of ROLLS) for (const tag of roll.tags) assert.ok(known.has(tag), `${roll.id}: ${tag}`);
});
