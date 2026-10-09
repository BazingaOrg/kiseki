import assert from 'node:assert/strict';
import test from 'node:test';

import {resolveChromeExecutable} from './chrome-browser.mjs';

test('an existing configured browser wins over installed browsers', () => {
  const seen = [];
  const found = resolveChromeExecutable('/configured/chrome', {
    platform: 'linux',
    exists: (item) => {
      seen.push(item);
      return item === '/configured/chrome';
    },
  });
  assert.equal(found, '/configured/chrome');
  assert.deepEqual(seen, ['/configured/chrome']);
});

test('a missing configured browser falls through to an installed one', () => {
  const found = resolveChromeExecutable('/missing/chrome', {
    platform: 'linux',
    exists: (item) => item === '/usr/bin/google-chrome',
  });
  assert.equal(found, '/usr/bin/google-chrome');
});

test('no installed browser leaves the renderer free to download its own', () => {
  assert.equal(resolveChromeExecutable(null, {platform: 'linux', exists: () => false}), null);
});
