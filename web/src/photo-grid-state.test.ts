import assert from 'node:assert/strict';
import test from 'node:test';

import {captionHintDraftKey, openPhotoIndex} from './photo-grid-state.ts';

test('open photo follows its absolute path when sorting changes', () => {
  const openPath = '/trip/photos/b.jpg';
  assert.equal(openPhotoIndex(['/trip/photos/a.jpg', openPath, '/trip/photos/c.jpg'], openPath), 1);
  assert.equal(openPhotoIndex(['/trip/photos/c.jpg', '/trip/photos/a.jpg', openPath], openPath), 2);
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
