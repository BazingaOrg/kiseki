import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import test from 'node:test';

import {terminateWindowsProcess} from './process-lifecycle.mjs';

test('Windows termination does not pass the caption key to taskkill', async () => {
  const previous = process.env.DEEPSEEK_API_KEY;
  process.env.DEEPSEEK_API_KEY = 'secret';
  try {
    const result = await terminateWindowsProcess(123, (command, args, options) => {
      assert.equal(command, 'taskkill.exe');
      assert.deepEqual(args, ['/PID', '123', '/T', '/F']);
      assert.equal(options.env.DEEPSEEK_API_KEY, undefined);
      const child = new EventEmitter();
      queueMicrotask(() => child.emit('close', 0));
      return child;
    });
    assert.equal(result, true);
  } finally {
    if (previous === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = previous;
  }
});
