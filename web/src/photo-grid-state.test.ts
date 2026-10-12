import assert from 'node:assert/strict';
import test from 'node:test';

import {captionHintDraftKey, openPhotoIndex, resolveOpenPhoto} from './photo-grid-state.ts';

test('open photo follows its absolute path when sorting changes', () => {
  const openPath = '/trip/photos/b.jpg';
  assert.equal(openPhotoIndex(['/trip/photos/a.jpg', openPath, '/trip/photos/c.jpg'], openPath), 1);
  assert.equal(openPhotoIndex(['/trip/photos/c.jpg', '/trip/photos/a.jpg', openPath], openPath), 2);
});

test('a deleted open photo stays on the neighbor without closing first', () => {
  const open = {groupKey: 'materials', path: '/trip/b.jpg'};
  const paths = ['/trip/a.jpg', '/trip/c.jpg'];
  assert.deepEqual(resolveOpenPhoto({open, groupKey: 'materials', paths, lastIndex: 1}), {
    groupKey: 'materials',
    path: '/trip/c.jpg',
  });
  assert.equal(resolveOpenPhoto({open, groupKey: 'materials', paths: ['/trip/a.jpg'], lastIndex: 1})?.path, '/trip/a.jpg');
  assert.equal(resolveOpenPhoto({open, groupKey: 'materials', paths: [], lastIndex: 1}), null);
  assert.equal(resolveOpenPhoto({open, groupKey: null, paths, lastIndex: 1}), null);
  assert.equal(resolveOpenPhoto({open, groupKey: 'materials', paths: ['/trip/a.jpg', '/trip/b.jpg', '/trip/c.jpg'], lastIndex: 0}), open);
});

test('caption hint drafts are isolated by project and absolute photo path', () => {
  assert.notEqual(
    captionHintDraftKey('/trip-one', '/trip-one/photo.jpg'),
    captionHintDraftKey('/trip-two', '/trip-two/photo.jpg'),
  );
  assert.notEqual(
    captionHintDraftKey('/trip', '/trip/a/photo.jpg'),
    captionHintDraftKey('/trip', '/trip/b/photo.jpg'),
  );
});
