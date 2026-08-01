import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {outputArtifactPaths} from './atomic-output.mjs';
import {executorIdentity} from './runtime-lifecycle.mjs';
import {artifactPath, canonicalResourceIdentity, createTaskLeaseManager, stableClaimKey} from './task-lease.mjs';

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
    assert.deepEqual(manager.extendOutputClaims(lease, [output]), [artifactPath(output)]);
    assert.equal(manager.release(lease), true);
  } finally {
    fs.rmSync(root, {recursive: true, force: true});
  }
});

test('verifyLeaseOwnership is true only while every v2 durable claim is held', () => {
  const root = fixture();
  try {
    const registryRoot = path.join(root, 'runtime');
    const project = path.join(root, 'project');
    const manager = createTaskLeaseManager({registryRoot});
    const lease = manager.acquire({resources: [project]});
    assert.equal(manager.verifyLeaseOwnership(lease), true);
    assert.equal(manager.verifyLeaseOwnership({...lease, token: 'wrong'}), false);
    assert.equal(manager.verifyLeaseOwnership({...lease, id: 'wrong'}), false);
    assert.equal(manager.release(lease), true);
    assert.equal(manager.verifyLeaseOwnership(lease), false);
  } finally { fs.rmSync(root, {recursive: true, force: true}); }
});

test('verifyLeaseOwnership is false in a failed release window with a removed claim', () => {
  const root = fixture();
  try {
    const registryRoot = path.join(root, 'runtime');
    const project = path.join(root, 'project');
    const manager = createTaskLeaseManager({registryRoot});
    const lease = manager.acquire({resources: [project]});
    const key = stableClaimKey(lease.resources[0]);
    fs.rmSync(path.join(registryRoot, 'claims', `${crypto.createHash('sha256').update(key).digest('hex')}.json`));
    assert.equal(manager.release(lease), false);
    assert.equal(fs.existsSync(lease.taskRoot), true);
    assert.equal(manager.verifyLeaseOwnership(lease), false);
  } finally { fs.rmSync(root, {recursive: true, force: true}); }
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
    assert.deepEqual(manifest.outputPaths, [artifactPath(path.join(actualOutput, 'movie.mp4'))]);
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
    assert.throws(() => createTaskLeaseManager({registryRoot}).acquire({resources: [project], outputPaths: [output]}), /普通文件/);
  } finally {
    fs.rmSync(root, {recursive: true, force: true});
  }
});

test('existing output directories are rejected before a lease can mutate them', () => {
  const root = fixture();
  try {
    const registryRoot = path.join(root, 'runtime');
    const project = path.join(root, 'project');
    const output = path.join(root, 'output.mp4');
    fs.mkdirSync(project, {recursive: true});
    fs.mkdirSync(output);
    assert.throws(() => createTaskLeaseManager({registryRoot}).acquire({resources: [project], outputPaths: [output]}), /普通文件/);
  } finally { fs.rmSync(root, {recursive: true, force: true}); }
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

test('v2 claim key is lexical for non-existent darwin paths and keeps the operation path physical', () => {
  const root = fixture();
  try {
    const registryRoot = path.join(root, 'runtime');
    const realParent = path.join(root, 'RealParent');
    const linkedParent = path.join(root, 'linked-parent');
    fs.mkdirSync(realParent);
    fs.symlinkSync(realParent, linkedParent);
    const first = path.join(linkedParent, 'New', '\u00c9.MP4');
    const second = path.join(realParent, 'new', 'e\u0301.mp4');
    const manager = createTaskLeaseManager({registryRoot, platform: 'darwin'});
    const lease = manager.acquire({resources: [path.join(root, 'project')], outputPaths: [first]});
    const manifest = JSON.parse(fs.readFileSync(path.join(lease.taskRoot, 'manifest.json'), 'utf8'));
    assert.equal(manifest.identityVersion, 2);
    assert.deepEqual(manifest.claimKeys, manifest.resources.map((resource) => stableClaimKey(resource, {platform: 'darwin'})));
    assert.throws(() => manager.acquire({resources: [path.join(root, 'other')], outputPaths: [second]}), /项目已有任务/);
    assert.equal(manager.release(lease), true);
  } finally { fs.rmSync(root, {recursive: true, force: true}); }
});

test('claim keys preserve linux case and fold win32 case without touching the filesystem', () => {
  const root = fixture();
  try {
    const first = path.join(root, 'Foo', 'missing.mp4');
    const second = path.join(root, 'foo', 'MISSING.mp4');
    assert.notEqual(stableClaimKey(first, {platform: 'linux'}), stableClaimKey(second, {platform: 'linux'}));
    assert.notEqual(stableClaimKey(first, {platform: 'aix'}), stableClaimKey(second, {platform: 'aix'}));
    assert.notEqual(stableClaimKey(first, {platform: 'freebsd'}), stableClaimKey(second, {platform: 'freebsd'}));
    assert.equal(stableClaimKey(first, {platform: 'win32'}), stableClaimKey(second, {platform: 'win32'}));
  } finally { fs.rmSync(root, {recursive: true, force: true}); }
});

test('two dead legacy tasks claiming one requested key block without recovery', () => {
  const root = fixture();
  try {
    const registryRoot = path.join(root, 'runtime');
    const project = path.join(root, 'project');
    const manager = createTaskLeaseManager({registryRoot, executorLiveness: () => 'dead'});
    for (const id of ['legacy-one', 'legacy-two']) {
      const taskRoot = path.join(registryRoot, 'tasks', id);
      fs.mkdirSync(taskRoot, {recursive: true});
      const canonicalProject = canonicalResourceIdentity(project);
      fs.writeFileSync(path.join(taskRoot, 'manifest.json'), JSON.stringify({id, taskRoot, resources: [canonicalProject], outputPaths: [], owner: {pid: 1, start: 'x'}}));
      fs.writeFileSync(path.join(registryRoot, 'claims', `${id}.json`), JSON.stringify({taskId: id, resource: canonicalProject}));
    }
    assert.throws(() => manager.acquire({resources: [project]}), /项目已有任务/);
    assert.equal(fs.existsSync(path.join(registryRoot, 'tasks', 'legacy-one')), true);
    assert.equal(fs.existsSync(path.join(registryRoot, 'tasks', 'legacy-two')), true);
    assert.equal(fs.existsSync(path.join(registryRoot, 'claims', 'legacy-one.json')), true);
    assert.equal(fs.existsSync(path.join(registryRoot, 'claims', 'legacy-two.json')), true);
  } finally { fs.rmSync(root, {recursive: true, force: true}); }
});

test('transitive legacy output conflict blocks recovery before either task mutates', () => {
  const root = fixture();
  try {
    const registryRoot = path.join(root, 'runtime');
    const x = path.join(root, 'project-x');
    const y = path.join(root, 'project-y', 'song.m4a');
    fs.mkdirSync(path.dirname(y), {recursive: true}); fs.writeFileSync(y, 'new');
    const manager = createTaskLeaseManager({registryRoot, executorLiveness: () => 'dead'});
    const aRoot = path.join(registryRoot, 'tasks', 'legacy-a'); const bRoot = path.join(registryRoot, 'tasks', 'legacy-b');
    fs.mkdirSync(aRoot, {recursive: true}); fs.mkdirSync(bRoot, {recursive: true});
    const canonicalX = canonicalResourceIdentity(x);
    const canonicalY = artifactPath(y);
    fs.writeFileSync(path.join(aRoot, 'manifest.json'), JSON.stringify({id: 'legacy-a', taskRoot: aRoot, resources: [canonicalX, canonicalY], outputPaths: [canonicalY], owner: {pid: 1, start: 'x'}}));
    fs.writeFileSync(path.join(bRoot, 'manifest.json'), JSON.stringify({id: 'legacy-b', taskRoot: bRoot, resources: [canonicalY], outputPaths: [], owner: {pid: 2, start: 'y'}}));
    for (const [name, taskId, resource] of [['a-x', 'legacy-a', canonicalX], ['a-y', 'legacy-a', canonicalY], ['b-y', 'legacy-b', canonicalY]]) fs.writeFileSync(path.join(registryRoot, 'claims', `${name}.json`), JSON.stringify({taskId, resource}));
    assert.throws(() => manager.acquire({resources: [x]}), /项目已有任务/);
    assert.equal(fs.readFileSync(y, 'utf8'), 'new');
    assert.equal(fs.existsSync(aRoot), true); assert.equal(fs.existsSync(bRoot), true);
    assert.equal(fs.existsSync(path.join(registryRoot, 'claims', 'a-y.json')), true);
    assert.equal(fs.existsSync(path.join(registryRoot, 'claims', 'b-y.json')), true);
  } finally { fs.rmSync(root, {recursive: true, force: true}); }
});

test('v1 live claims block v2 acquisition before a v2 manifest is written', () => {
  const root = fixture();
  try {
    const registryRoot = path.join(root, 'runtime');
    const project = path.join(root, 'project');
    const manager = createTaskLeaseManager({registryRoot, executorLiveness: () => 'live'});
    const id = 'legacy-live';
    const taskRoot = path.join(registryRoot, 'tasks', id);
    fs.mkdirSync(taskRoot, {recursive: true});
    const canonicalProject = canonicalResourceIdentity(project);
    fs.writeFileSync(path.join(taskRoot, 'manifest.json'), JSON.stringify({id, taskRoot, resources: [canonicalProject], outputPaths: [], owner: {pid: 1, start: 'x'}}));
    fs.writeFileSync(path.join(registryRoot, 'claims', 'legacy.json'), JSON.stringify({taskId: id, resource: canonicalProject}));
    assert.throws(() => manager.acquire({resources: [project]}), /项目已有任务/);
  } finally { fs.rmSync(root, {recursive: true, force: true}); }
});

test('v1 pending claim requested by v2 blocks before a task or claim is created', () => {
  const root = fixture();
  try {
    const registryRoot = path.join(root, 'runtime');
    const project = path.join(root, 'project');
    const pending = path.join(root, 'pending');
    const manager = createTaskLeaseManager({registryRoot, executorLiveness: () => 'live'});
    const id = 'legacy-pending'; const taskRoot = path.join(registryRoot, 'tasks', id);
    fs.mkdirSync(taskRoot, {recursive: true});
    const canonicalProject = canonicalResourceIdentity(project);
    const canonicalPending = canonicalResourceIdentity(pending);
    fs.writeFileSync(path.join(taskRoot, 'manifest.json'), JSON.stringify({id, taskRoot, resources: [canonicalProject], pendingClaims: [canonicalPending], outputPaths: [], owner: {pid: 1, start: 'x'}}));
    fs.writeFileSync(path.join(registryRoot, 'claims', 'legacy-project.json'), JSON.stringify({taskId: id, resource: canonicalProject}));
    fs.writeFileSync(path.join(registryRoot, 'claims', 'legacy-pending.json'), JSON.stringify({taskId: id, resource: canonicalPending}));
    assert.throws(() => manager.acquire({resources: [pending]}), /项目已有任务/);
    assert.deepEqual(fs.readdirSync(path.join(registryRoot, 'tasks')), [id]);
  } finally { fs.rmSync(root, {recursive: true, force: true}); }
});

test('orphan legacy claim for a requested key blocks before v2 writes', () => {
  const root = fixture();
  try {
    const registryRoot = path.join(root, 'runtime');
    const project = path.join(root, 'project');
    const manager = createTaskLeaseManager({registryRoot});
    fs.writeFileSync(path.join(registryRoot, 'claims', 'orphan.json'), JSON.stringify({taskId: 'gone', resource: canonicalResourceIdentity(project)}));
    assert.throws(() => manager.acquire({resources: [project]}), /项目已有任务/);
    assert.equal(fs.readdirSync(path.join(registryRoot, 'tasks')).length, 0);
  } finally { fs.rmSync(root, {recursive: true, force: true}); }
});

test('dead v1 committed transaction keeps final and removes exact legacy claims and backup', () => {
  const root = fixture();
  try {
    const registryRoot = path.join(root, 'runtime');
    const project = path.join(root, 'project');
    const finalPath = path.join(project, 'audio', 'song.m4a');
    fs.mkdirSync(path.dirname(finalPath), {recursive: true});
    fs.writeFileSync(finalPath, 'new');
    const id = 'legacy-dead';
    const taskRoot = path.join(registryRoot, 'tasks', id);
    const manager = createTaskLeaseManager({registryRoot, executorLiveness: () => 'dead'});
    fs.mkdirSync(taskRoot, {recursive: true});
    const canonicalProject = canonicalResourceIdentity(project);
    const canonicalFinalPath = artifactPath(finalPath);
    const artifacts = outputArtifactPaths(canonicalFinalPath, id);
    fs.writeFileSync(artifacts.backupPath, 'old');
    fs.writeFileSync(path.join(taskRoot, 'manifest.json'), JSON.stringify({
      id, taskRoot, resources: [canonicalProject, canonicalFinalPath], outputPaths: [canonicalFinalPath], owner: {pid: 1, start: 'x'},
      outputTransaction: {taskId: id, phase: 'committed', paths: [{path: canonicalFinalPath, hadFinal: true, delete: false}]},
    }));
    fs.writeFileSync(path.join(registryRoot, 'claims', 'legacy-project.json'), JSON.stringify({taskId: id, resource: canonicalProject}));
    fs.writeFileSync(path.join(registryRoot, 'claims', 'legacy-final.json'), JSON.stringify({taskId: id, resource: canonicalFinalPath}));
    const replacement = manager.acquire({resources: [project]});
    assert.equal(fs.readFileSync(finalPath, 'utf8'), 'new');
    assert.equal(fs.existsSync(artifacts.backupPath), false);
    assert.equal(fs.existsSync(taskRoot), false);
    assert.equal(manager.release(replacement), true);
  } finally { fs.rmSync(root, {recursive: true, force: true}); }
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
    assert.deepEqual(manifest.outputPaths, [artifactPath(path.join(outputDir, 'NewDir', 'out.mp4'))]);
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
    const canonicalOutput = artifactPath(output);
    const outputKey = stableClaimKey(canonicalOutput);
    fs.writeFileSync(manifestFile, JSON.stringify({...manifest, pendingOutputClaims: [canonicalOutput], pendingClaimKeys: [outputKey]}));
    const claim = path.join(registryRoot, 'claims', `${crypto.createHash('sha256').update(outputKey).digest('hex')}.json`);
    fs.writeFileSync(claim, JSON.stringify({identityVersion: 2, taskId: stale.id, resourcePath: canonicalOutput, claimKey: outputKey}));

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

test('stale prepared transaction preserves an externally created final and removes only its partial', () => {
  const root = fixture();
  try {
    const registryRoot = path.join(root, 'runtime'); const project = path.join(root, 'project');
    const finalPath = path.join(project, 'audio', 'new.m4a'); fs.mkdirSync(path.dirname(finalPath), {recursive: true});
    const manager = createTaskLeaseManager({registryRoot, executorLiveness: () => 'dead'});
    const lease = manager.acquire({resources: [project], outputPaths: [finalPath]});
    manager.prepareOutputTransaction(lease, [{finalPath, delete: false}]);
    const artifacts = outputArtifactPaths(finalPath, lease.id);
    fs.writeFileSync(artifacts.partialPath, 'staged'); fs.writeFileSync(finalPath, 'external');
    createTaskLeaseManager({registryRoot, executorLiveness: () => 'dead'}).acquire({resources: [project]});
    assert.equal(fs.readFileSync(finalPath, 'utf8'), 'external');
    assert.equal(fs.existsSync(artifacts.partialPath), false);
  } finally { fs.rmSync(root, {recursive: true, force: true}); }
});

test('stale prepared transaction does not synthesize a disappeared former final', () => {
  const root = fixture();
  try {
    const registryRoot = path.join(root, 'runtime'); const project = path.join(root, 'project');
    const finalPath = path.join(project, 'audio', 'old.m4a'); fs.mkdirSync(path.dirname(finalPath), {recursive: true}); fs.writeFileSync(finalPath, 'old');
    const manager = createTaskLeaseManager({registryRoot, executorLiveness: () => 'dead'});
    const lease = manager.acquire({resources: [project], outputPaths: [finalPath]});
    manager.prepareOutputTransaction(lease, [{finalPath, delete: false}]); fs.rmSync(finalPath);
    createTaskLeaseManager({registryRoot, executorLiveness: () => 'dead'}).acquire({resources: [project]});
    assert.equal(fs.existsSync(finalPath), false);
  } finally { fs.rmSync(root, {recursive: true, force: true}); }
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
    fs.writeFileSync(manifestFile, JSON.stringify({...manifest, resources: [], claimKeys: [], pendingClaims: [stale.resources[0]], pendingClaimKeys: [stableClaimKey(stale.resources[0])]}));

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
