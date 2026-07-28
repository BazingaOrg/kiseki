import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {outputArtifactPaths} from './atomic-output.mjs';
import {executorIdentity} from './runtime-lifecycle.mjs';
import {createTaskLeaseManager} from './task-lease.mjs';

const fixture = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tsuzuri-lease-'));

test('confirmed-stale lease removes its partial and restores its deterministic backup', () => {
  const root = fixture();
  try {
    const registryRoot = path.join(root, 'runtime');
    const project = path.join(root, 'project');
    const output = path.join(project, 'output', 'movie.mp4');
    fs.mkdirSync(path.dirname(output), {recursive: true});
    const stale = createTaskLeaseManager({registryRoot, executorLiveness: () => 'dead'}).acquire({resources: [project], outputPaths: [output]});
    const {partialPath, backupPath} = outputArtifactPaths(output, stale.id);
    fs.writeFileSync(partialPath, 'partial');
    fs.writeFileSync(backupPath, 'old final');

    const replacement = createTaskLeaseManager({registryRoot, executorLiveness: () => 'dead'}).acquire({resources: [project], outputPaths: [output]});
    assert.equal(fs.readFileSync(output, 'utf8'), 'old final');
    assert.equal(fs.existsSync(partialPath), false);
    assert.equal(fs.existsSync(backupPath), false);
    assert.equal(createTaskLeaseManager({registryRoot}).release(replacement), true);
  } finally {
    fs.rmSync(root, {recursive: true, force: true});
  }
});

test('authenticated owner can extend output claims for precise stale cleanup', () => {
  const root = fixture();
  try {
    const registryRoot = path.join(root, 'runtime');
    const project = path.join(root, 'project');
    const output = path.join(project, 'audio', 'song.lrc');
    const manager = createTaskLeaseManager({registryRoot});
    const lease = manager.acquire({resources: [project]});
    assert.deepEqual(manager.extendOutputClaims(lease, [output]), [output]);
    assert.equal(manager.release(lease), true);
  } finally {
    fs.rmSync(root, {recursive: true, force: true});
  }
});

test('output claims retain the real parent and literal final basename', () => {
  const root = fixture();
  try {
    const registryRoot = path.join(root, 'runtime');
    const project = path.join(root, 'project');
    const actualOutput = path.join(root, 'actual-output');
    const linkedOutput = path.join(root, 'linked-output');
    fs.mkdirSync(project, {recursive: true});
    fs.mkdirSync(actualOutput);
    fs.symlinkSync(actualOutput, linkedOutput);
    const output = path.join(linkedOutput, 'movie.mp4');
    const manager = createTaskLeaseManager({registryRoot});
    const lease = manager.acquire({resources: [project], outputPaths: [output]});
    const manifest = JSON.parse(fs.readFileSync(path.join(lease.taskRoot, 'manifest.json'), 'utf8'));
    assert.deepEqual(manifest.outputPaths, [path.join(actualOutput, 'movie.mp4')]);
    assert.equal(manager.release(lease), true);
  } finally {
    fs.rmSync(root, {recursive: true, force: true});
  }
});

test('an existing output symlink is rejected instead of claiming its target', () => {
  const root = fixture();
  try {
    const registryRoot = path.join(root, 'runtime');
    const project = path.join(root, 'project');
    const outputDir = path.join(root, 'output');
    const target = path.join(root, 'target.mp4');
    const output = path.join(outputDir, 'movie.mp4');
    fs.mkdirSync(project, {recursive: true});
    fs.mkdirSync(outputDir);
    fs.writeFileSync(target, 'target');
    fs.symlinkSync(target, output);
    assert.throws(() => createTaskLeaseManager({registryRoot}).acquire({resources: [project], outputPaths: [output]}), /不能是符号链接/);
  } finally {
    fs.rmSync(root, {recursive: true, force: true});
  }
});

test('darwin claim keys fold Unicode and case across the unresolved tail', () => {
  const root = fixture();
  try {
    const registryRoot = path.join(root, 'runtime');
    const projectOne = path.join(root, 'project-one');
    const projectTwo = path.join(root, 'project-two');
    const outputDir = path.join(root, 'output');
    fs.mkdirSync(projectOne, {recursive: true});
    fs.mkdirSync(projectTwo);
    fs.mkdirSync(outputDir);
    const first = path.join(outputDir, '\u00e9.mp4');
    const second = path.join(outputDir, 'e\u0301.MP4');
    const manager = createTaskLeaseManager({registryRoot, platform: 'darwin'});
    const lease = manager.acquire({resources: [projectOne], outputPaths: [first]});
    assert.throws(() => manager.acquire({resources: [projectTwo], outputPaths: [second]}), /项目已有任务/);
    assert.equal(manager.release(lease), true);
  } finally {
    fs.rmSync(root, {recursive: true, force: true});
  }
});

test('darwin claim keys fold every unresolved path segment', () => {
  const root = fixture();
  try {
    const registryRoot = path.join(root, 'runtime');
    const projectOne = path.join(root, 'project-one');
    const projectTwo = path.join(root, 'project-two');
    const outputDir = path.join(root, 'output');
    fs.mkdirSync(projectOne, {recursive: true});
    fs.mkdirSync(projectTwo);
    fs.mkdirSync(outputDir);
    const manager = createTaskLeaseManager({registryRoot, platform: 'darwin'});
    const lease = manager.acquire({resources: [projectOne], outputPaths: [path.join(outputDir, 'NewDir', 'out.mp4')]});
    const manifest = JSON.parse(fs.readFileSync(path.join(lease.taskRoot, 'manifest.json'), 'utf8'));
    assert.deepEqual(manifest.outputPaths, [path.join(outputDir, 'NewDir', 'out.mp4')]);
    assert.throws(() => manager.acquire({resources: [projectTwo], outputPaths: [path.join(outputDir, 'newdir', 'out.mp4')]}), /项目已有任务/);
    assert.equal(manager.release(lease), true);
  } finally {
    fs.rmSync(root, {recursive: true, force: true});
  }
});

test('linux claim keys preserve unresolved path case', () => {
  const root = fixture();
  try {
    const registryRoot = path.join(root, 'runtime');
    const projectOne = path.join(root, 'project-one');
    const projectTwo = path.join(root, 'project-two');
    const outputDir = path.join(root, 'output');
    fs.mkdirSync(projectOne, {recursive: true});
    fs.mkdirSync(projectTwo);
    fs.mkdirSync(outputDir);
    const manager = createTaskLeaseManager({registryRoot, platform: 'linux'});
    const first = manager.acquire({resources: [projectOne], outputPaths: [path.join(outputDir, 'NewDir', 'out.mp4')]});
    const second = manager.acquire({resources: [projectTwo], outputPaths: [path.join(outputDir, 'newdir', 'out.mp4')]});
    assert.equal(manager.release(second), true);
    assert.equal(manager.release(first), true);
  } finally {
    fs.rmSync(root, {recursive: true, force: true});
  }
});

test('stale pending output claims recover only the dead task claim subset', () => {
  const root = fixture();
  try {
    const registryRoot = path.join(root, 'runtime');
    const project = path.join(root, 'project');
    const replacementProject = path.join(root, 'replacement-project');
    const output = path.join(root, 'output', 'song.lrc');
    fs.mkdirSync(project, {recursive: true});
    fs.mkdirSync(replacementProject);
    fs.mkdirSync(path.dirname(output));
    const manager = createTaskLeaseManager({registryRoot, executorLiveness: () => 'dead'});
    const stale = manager.acquire({resources: [project]});
    const manifestFile = path.join(stale.taskRoot, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    fs.writeFileSync(manifestFile, JSON.stringify({...manifest, pendingOutputClaims: [output]}));
    const claim = path.join(registryRoot, 'claims', `${crypto.createHash('sha256').update(output).digest('hex')}.json`);
    fs.writeFileSync(claim, JSON.stringify({taskId: stale.id, resource: output}));

    const replacement = manager.acquire({resources: [replacementProject], outputPaths: [output]});
    assert.equal(fs.existsSync(path.join(stale.taskRoot, 'manifest.json')), false);
    assert.equal(manager.release(replacement), true);
  } finally {
    fs.rmSync(root, {recursive: true, force: true});
  }
});

test('stale committing output transaction rolls back its complete path set', () => {
  const root = fixture();
  try {
    const registryRoot = path.join(root, 'runtime');
    const project = path.join(root, 'project');
    const oldPath = path.join(project, 'audio', 'old.m4a');
    const newPath = path.join(project, 'audio', 'new.m4a');
    fs.mkdirSync(path.dirname(oldPath), {recursive: true});
    fs.writeFileSync(oldPath, 'old');
    const manager = createTaskLeaseManager({registryRoot, executorLiveness: () => 'dead'});
    const lease = manager.acquire({resources: [project], outputPaths: [oldPath, newPath]});
    manager.prepareOutputTransaction(lease, [{finalPath: oldPath, delete: true}, {finalPath: newPath, delete: false}]);
    manager.setOutputTransactionPhase(lease, 'committing');
    const oldArtifacts = outputArtifactPaths(oldPath, lease.id);
    fs.renameSync(oldPath, oldArtifacts.backupPath);
    fs.writeFileSync(newPath, 'new');
    createTaskLeaseManager({registryRoot, executorLiveness: () => 'dead'}).acquire({resources: [project]});
    assert.equal(fs.readFileSync(oldPath, 'utf8'), 'old');
    assert.equal(fs.existsSync(newPath), false);
  } finally {
    fs.rmSync(root, {recursive: true, force: true});
  }
});

test('stale committed output transaction keeps all new finals', () => {
  const root = fixture();
  try {
    const registryRoot = path.join(root, 'runtime');
    const project = path.join(root, 'project');
    const finalPath = path.join(project, 'audio', 'song.m4a');
    fs.mkdirSync(path.dirname(finalPath), {recursive: true});
    fs.writeFileSync(finalPath, 'old');
    const manager = createTaskLeaseManager({registryRoot, executorLiveness: () => 'dead'});
    const lease = manager.acquire({resources: [project], outputPaths: [finalPath]});
    manager.prepareOutputTransaction(lease, [{finalPath, delete: false}]);
    manager.setOutputTransactionPhase(lease, 'committing');
    const artifacts = outputArtifactPaths(finalPath, lease.id);
    fs.renameSync(finalPath, artifacts.backupPath);
    fs.writeFileSync(finalPath, 'new');
    manager.setOutputTransactionPhase(lease, 'committed');
    createTaskLeaseManager({registryRoot, executorLiveness: () => 'dead'}).acquire({resources: [project]});
    assert.equal(fs.readFileSync(finalPath, 'utf8'), 'new');
    assert.equal(fs.existsSync(artifacts.backupPath), false);
  } finally {
    fs.rmSync(root, {recursive: true, force: true});
  }
});

test('a stale pending acquisition releases only claims already created', () => {
  const root = fixture();
  try {
    const registryRoot = path.join(root, 'runtime');
    const project = path.join(root, 'project');
    fs.mkdirSync(project, {recursive: true});
    const manager = createTaskLeaseManager({registryRoot, executorLiveness: () => 'dead'});
    const stale = manager.acquire({resources: [project]});
    const manifestFile = path.join(stale.taskRoot, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    fs.writeFileSync(manifestFile, JSON.stringify({...manifest, resources: [], pendingClaims: [stale.resources[0]]}));

    const replacement = manager.acquire({resources: [project]});
    assert.equal(manager.release(replacement), true);
  } finally {
    fs.rmSync(root, {recursive: true, force: true});
  }
});

test('a spawned child registers itself before its parent records the pid', () => {
  const root = fixture();
  try {
    const registryRoot = path.join(root, 'runtime');
    const project = path.join(root, 'project');
    fs.mkdirSync(project, {recursive: true});
    const manager = createTaskLeaseManager({registryRoot});
    const lease = manager.acquire({kind: 'render', resources: [project]});
    manager.markSpawnIntent(lease);
    const inherited = manager.attachInheritedLease({
      id: lease.id, token: lease.token, taskRoot: lease.taskRoot,
      expectedFolder: project, allowedParentKinds: ['render'],
    });
    assert.equal(inherited.inherited, true);
    const executor = executorIdentity(process.pid);
    assert.deepEqual(manager.registerExecutor(lease, executor), executor);
    assert.deepEqual(manager.registerExecutor(lease, {pid: executor.pid, start: null}), executor);
    assert.throws(() => manager.registerExecutor(lease, {pid: executor.pid, start: 'other'}), /identity 不匹配/);
    assert.throws(() => manager.registerExecutor(lease, {pid: 1, start: 'other'}), /identity 不匹配/);
    assert.equal(manager.release(lease), true);
  } finally {
    fs.rmSync(root, {recursive: true, force: true});
  }
});
