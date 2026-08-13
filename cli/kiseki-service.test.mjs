import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {createKisekiService} from './kiseki-service.mjs';
import {createMutableRootController} from './root-controller.mjs';

test('service starts without an authorized root and switches only to a canonical directory', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kiseki-service-root-'));
  const service = createKisekiService({rootController: createMutableRootController(), startPort: 0});
  const started = await service.start();
  const response = await fetch(started.url);
  assert.equal(response.status, 200);
  assert.throws(() => service.getRoot(), /尚未授权/);
  assert.equal(service.switchRoot(root).path, fs.realpathSync(root));
  await service.shutdown();
  fs.rmSync(root, {recursive: true});
});

test('invalid switch preserves current root', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kiseki-service-root-'));
  const service = createKisekiService({rootController: createMutableRootController({initialRoot: root})});
  assert.throws(() => service.switchRoot(path.join(root, 'missing')));
  assert.equal(service.getRoot().path, fs.realpathSync(root));
  fs.rmSync(root, {recursive: true});
});
