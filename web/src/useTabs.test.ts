import assert from 'node:assert/strict';
import test from 'node:test';

import {nextTabValue} from './useTabs.ts';

const values = ['photos', 'music'] as const;

test('tab keyboard navigation wraps and Home/End select bounds', () => {
  assert.equal(nextTabValue(values, 'photos', 'ArrowLeft'), 'music');
  assert.equal(nextTabValue(values, 'music', 'ArrowRight'), 'photos');
  assert.equal(nextTabValue(values, 'music', 'Home'), 'photos');
  assert.equal(nextTabValue(values, 'music', 'End'), 'music');
});

test('tab keyboard navigation advances from the currently focused tab', () => {
  assert.equal(nextTabValue(values, 'photos', 'ArrowRight'), 'music');
  assert.equal(nextTabValue(values, 'music', 'ArrowLeft'), 'photos');
});
