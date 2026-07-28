import assert from 'node:assert/strict';
import test from 'node:test';

import {normalizeFilterIntensity, resolveFilterOutputSuffix} from './output-naming.mjs';

test('default, implicit renderer intensity, and ineffective explicit config leave the suffix unchanged', () => {
  assert.equal(resolveFilterOutputSuffix(), '');
  assert.equal(resolveFilterOutputSuffix({filter: {id: 'mono'}}), '-mono');
  assert.equal(resolveFilterOutputSuffix({filterConfig: {intensity: 0.8}, photoNames: ['a.jpg']}), '');
});

test('filter aliases use the canonical registry id and equivalent strengths share a suffix', () => {
  assert.equal(resolveFilterOutputSuffix({filter: {id: 'teal_orange', intensity: 0.8}}), '-teal-orange-0.8');
  assert.equal(normalizeFilterIntensity(0.80), '0.8');
  assert.equal(resolveFilterOutputSuffix({filter: {id: 'mono', intensity: 0.8}}), '-mono-0.8');
});

test('project configuration reflects every effective filter combination without using a default intensity', () => {
  assert.equal(
    resolveFilterOutputSuffix({
      filterConfig: {filter: 'mono', perPhoto: {'b.jpg': {filter: 'riso', intensity: 0.5}}},
      photoNames: ['b.jpg', 'a.jpg'],
    }),
    '-filters-mono-riso-0.5',
  );
});
