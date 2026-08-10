import assert from 'node:assert/strict';
import test from 'node:test';

import {TEMPLATES, resolveTemplatePresentation, templateById} from './templates.ts';

test('template registry has unique ids and required display fields', () => {
  const ids = new Set<string>();
  for (const template of TEMPLATES) {
    assert.ok(!ids.has(template.id), `重复的模板 id: ${template.id}`);
    ids.add(template.id);
    assert.ok(template.name.length > 0, `${template.id} 缺名称`);
    assert.ok(template.description.length > 0, `${template.id} 缺描述`);
    assert.ok(['Diary', 'PolaroidWall'].includes(template.composition), `${template.id} 的 composition 不合法`);
    assert.ok(['album', 'cut', 'crossfade'].includes(template.transition), `${template.id} 的转场不合法`);
    if (template.motion) {
      assert.equal(template.motion.type, 'kenburns', `${template.id} 的运镜类型不合法`);
      assert.ok(template.motion.zoom >= 1, `${template.id} 的运镜 zoom 必须 >= 1`);
      assert.ok(['center', 'left', 'right', 'up', 'down', 'random'].includes(template.motion.pan), `${template.id} 的运镜方向不合法`);
    }
  }
  assert.ok(ids.size >= 4, '至少要有 4 个模板(含 polaroid)');
  assert.equal(templateById('polaroid')?.composition, 'PolaroidWall');
});

test('resolveTemplatePresentation resolves a known template and falls back without one', () => {
  const cut = resolveTemplatePresentation('news-cut');
  assert.deepEqual(cut.transition, {type: 'cut', duration: 0});
  assert.equal(cut.captions?.fontWeight, 700);
  assert.ok(cut.chapterCard, 'news-cut 应有章节卡样式');
  assert.equal(cut.motion, undefined, 'news-cut 不带运镜');
  assert.equal(cut.fontFamily, 'sans', 'news-cut 用黑体');

  const cinema = resolveTemplatePresentation('slow-cinema');
  assert.deepEqual(cinema.transition, {type: 'crossfade', duration: 0.6});
  assert.deepEqual(cinema.motion, {type: 'kenburns', zoom: 1.06, pan: 'random'});
  assert.equal(cinema.fontFamily, 'serif', 'slow-cinema 保持衬线');

  const plain = resolveTemplatePresentation(undefined);
  assert.deepEqual(plain, {transition: undefined, motion: undefined, fontFamily: 'serif', captions: undefined, chapterCard: undefined});

  // 未知 id 同样回落为"不应用模板",不会让渲染崩溃
  assert.deepEqual(resolveTemplatePresentation('nope'), plain);
});

test('templateById finds or misses', () => {
  assert.equal(templateById('slow-cinema')?.transition, 'crossfade');
  assert.equal(templateById('missing'), undefined);
});
