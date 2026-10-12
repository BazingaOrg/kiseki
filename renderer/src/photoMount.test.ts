import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

test('a photo frame is not a component declared during render', () => {
  const source = fs.readFileSync(new URL('./Photo.tsx', import.meta.url), 'utf8');
  const body = source.slice(source.indexOf('export const Photo'));
  const declared = [...body.matchAll(/const ([A-Z][A-Za-z0-9]*) = \(/g)].map((match) => match[1]);
  const usedAsComponent = declared.filter((name) => body.includes(`<${name}`));
  assert.deepEqual(usedAsComponent, []);
});
