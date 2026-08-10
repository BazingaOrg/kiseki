import assert from 'node:assert/strict';
import test from 'node:test';

import {normalizeTemplateId, resolveTemplateComposition, TEMPLATE_IDS, TEMPLATES} from './templates.mjs';

test('registry lists every template with a composition', () => {
  assert.ok(TEMPLATE_IDS.length >= 3, '至少 3 个模板(album 与默认重复已砍)');
  for (const template of TEMPLATES) {
    assert.ok(['Diary', 'PolaroidWall'].includes(template.composition), `${template.id} 的 composition 不合法`);
  }
  assert.equal(TEMPLATES.find((t) => t.id === 'polaroid')?.composition, 'PolaroidWall');
});

test('normalizeTemplateId accepts registry ids only', () => {
  assert.equal(normalizeTemplateId('polaroid'), 'polaroid');
  assert.equal(normalizeTemplateId('nope'), null);
  assert.equal(normalizeTemplateId(null), null);
});

test('resolveTemplateComposition falls back to Diary without a template', () => {
  assert.equal(resolveTemplateComposition('polaroid'), 'PolaroidWall');
  assert.equal(resolveTemplateComposition('slow-cinema'), 'Diary');
  assert.equal(resolveTemplateComposition(undefined), 'Diary');
  assert.equal(resolveTemplateComposition('nope'), 'Diary');
});
