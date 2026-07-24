import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';

import {FILTER_IDS} from './filters.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test('cli FILTER_IDS stays in sync with renderer/src/filters.ts FILTERS registry', () => {
  const source = fs.readFileSync(path.join(__dirname, '../renderer/src/filters.ts'), 'utf8');
  const registryBody = source.slice(
    source.indexOf('export const FILTERS'),
    source.indexOf('] as const;'),
  );
  const ids = [...registryBody.matchAll(/id: '([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(ids, FILTER_IDS);
});
