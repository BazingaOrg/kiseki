import assert from 'node:assert/strict';
import test from 'node:test';
import {FILTERS, FILTER_IDS, getFilter, getFilterDef} from './filters.ts';

test('registry ids are unique and match FILTER_IDS', () => {
  const ids = FILTERS.map((f) => f.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(FILTER_IDS, ids);
});

test('visible filters are the nine ordered classic camera and film styles', () => {
  const visible = FILTERS.filter((filter) => filter.group !== 'legacy');
  assert.deepEqual(
    visible.map((filter) => filter.id),
    [
      'fuji-classic-chrome',
      'fuji-classic-neg',
      'ricoh-positive',
      'ricoh-negative',
      'leica-classic',
      'kodak-portra-400',
      'kodak-gold-200',
      'fuji-velvia-50',
      'ilford-hp5',
    ],
  );
  assert.equal(visible.filter((filter) => filter.group === 'camera').length, 5);
  assert.equal(visible.filter((filter) => filter.group === 'film').length, 4);
});

test('every filter def has at least one implementation (css, svg, or overlay)', () => {
  for (const def of FILTERS) {
    const impls = [def.css, def.svg, def.overlay].filter(Boolean);
    assert.ok(impls.length >= 1, `${def.id} should define at least one of css/svg/overlay`);
  }
});

test('getFilter with unknown or missing id returns an identity result', () => {
  assert.deepEqual(getFilter(null), {imgStyle: {}, svgDefMarkup: null, svgFilterId: null, overlayStyle: null});
  assert.deepEqual(getFilter(undefined), {imgStyle: {}, svgDefMarkup: null, svgFilterId: null, overlayStyle: null});
  assert.deepEqual(getFilter('does-not-exist'), {imgStyle: {}, svgDefMarkup: null, svgFilterId: null, overlayStyle: null});
});

test('intensity is clamped to [0, 1]', () => {
  const over = getFilter('mono', 5);
  const atMax = getFilter('mono', 1);
  assert.deepEqual(over, atMax);

  const under = getFilter('mono', -5);
  const atMin = getFilter('mono', 0);
  assert.deepEqual(under, atMin);
});

test('css filters are identity-equivalent at intensity 0 and defined at intensity 1', () => {
  for (const def of FILTERS.filter((f) => f.css)) {
    const zero = getFilter(def.id, 0);
    const one = getFilter(def.id, 1);
    assert.ok(zero.imgStyle.filter, `${def.id} should produce a filter string`);
    assert.notEqual(zero.imgStyle.filter, one.imgStyle.filter, `${def.id} should change between intensity 0 and 1`);
  }
});

test('classic filters change from intensity 0 to 1', () => {
  for (const def of FILTERS.filter((filter) => filter.group !== 'legacy')) {
    assert.notDeepEqual(getFilter(def.id, 0), getFilter(def.id, 1), `${def.id} should change between intensity 0 and 1`);
  }
});

test('svg filters produce matching defMarkup and filterId referencing each other', () => {
  for (const def of FILTERS.filter((f) => f.svg)) {
    const resolved = getFilter(def.id, 0.5);
    assert.ok(resolved.svgFilterId?.includes(def.id));
    assert.ok(resolved.svgDefMarkup?.includes(resolved.svgFilterId!));
    assert.ok((resolved.imgStyle.filter as string).includes(`url(#${resolved.svgFilterId})`));
  }
});

test('svg filter id fingerprints intensity so different intensities never collide', () => {
  for (const def of FILTERS.filter((f) => f.svg)) {
    const low = getFilter(def.id, 0.2);
    const high = getFilter(def.id, 0.8);
    assert.notEqual(low.svgFilterId, high.svgFilterId);
    assert.ok(low.svgDefMarkup?.includes(low.svgFilterId!));
    assert.ok(high.svgDefMarkup?.includes(high.svgFilterId!));
  }
});

test('overlay filters return a style object at nonzero intensity', () => {
  for (const def of FILTERS.filter((f) => f.overlay)) {
    const resolved = getFilter(def.id, 0.5);
    assert.ok(resolved.overlayStyle);
  }
});

test('defaultIntensity is used when intensity is omitted', () => {
  const withDefault = getFilter('faded');
  const def = getFilterDef('faded')!;
  const explicit = getFilter('faded', def.defaultIntensity);
  assert.deepEqual(withDefault, explicit);
});
