import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const source = (name: string) => readFile(new URL(`./${name}`, import.meta.url), 'utf8');

test('smiles sit on welcome, empty, ready and done — never on errors', async () => {
  const [app, materials, make, job] = await Promise.all([
    source('App.tsx'), source('Materials.tsx'), source('Make.tsx'), source('JobPanel.tsx'),
  ]);
  assert.match(app, /剩下的交给 <span className="welcome-signoff">kiseki ：）<\/span>/);
  assert.match(materials, /jpg \/ png \/ webp 都可以 ：）/);
  assert.match(materials, /没搜到，换个说法试试 ：）/);
  assert.match(make, /素材齐了，可以开工 ：）/);
  assert.match(job, /完成了 ：）/);
  assert.doesNotMatch(job, /已取消 ：）|失败了 ：）/);
  assert.doesNotMatch(app, /无法读取运行环境。 ：）|请重新选择。 ：）/);
  assert.doesNotMatch(materials, /出了点问题 ：）|hint-error[\s\S]{0,80}：）/);
});
