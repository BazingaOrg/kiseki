import fs from 'node:fs';
import {bakeLut, createColorTransform, formatCube, getRoll} from '../src/index.mjs';

const [id, size, out] = process.argv.slice(2);
const roll = getRoll(id);
if (!roll || !out) {
  console.error('usage: node tools/bake_prior.mjs <roll-id> <size> <out.cube>');
  process.exit(1);
}
fs.writeFileSync(out, formatCube(bakeLut(createColorTransform(roll.color), Number(size)), `${id} parametric prior`));
