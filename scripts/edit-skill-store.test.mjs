import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { snapshotEditSkill } from '../src/lib/edit-skill-store.ts';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'ai-editor-skill-test-'));
  t.after(async () => {
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + '\\ai-editor-skill-test-') || resolve(root).startsWith(resolve(tmpdir()) + '/ai-editor-skill-test-'));
    await rm(root, { recursive: true, force: true });
  });
  const jobPath = join(root, 'native-assets', 'edit-test');
  await mkdir(jobPath, { recursive: true });
  const sourcePath = join(jobPath, 'raw.mp4');
  const referencePath = join(jobPath, 'reference.mp4');
  const plan = { width: 720, height: 1280, fps: 30, tracks: [{ name: 'Source', type: 'video', items: [{ path: sourcePath, start: 0, duration: 2 }] }],
    operations: [{ op: 'keyframe', target: 'source', property: 'rotation', time: 0.65, value: 7 }] };
  await Promise.all([writeFile(join(jobPath, 'spec.json'), JSON.stringify(plan)),
    writeFile(join(jobPath, 'manifest.json'), JSON.stringify({ supported: true, effects: ['Custom movement'] })),
    writeFile(referencePath, 'reference')]);
  return { root, jobPath, referencePath, plan, input: { id: randomUUID(), name: ' My named skill ', prompt: 'Match the reference',
    referencePath, effects: ['Custom movement'], sourceName: 'raw.mp4', jobPath } };
}

test('saves the chosen name and a frozen copy of actual edit settings', async (t) => {
  const { root, jobPath, plan, input } = await fixture(t);
  const skill = await snapshotEditSkill(input, root);
  assert.equal(skill.name, 'My named skill');
  assert.equal(skill.buildDirectory, jobPath);
  assert.deepEqual(JSON.parse(await readFile(skill.planPath, 'utf8')), plan);
  await writeFile(join(jobPath, 'spec.json'), '{}');
  assert.deepEqual(JSON.parse(await readFile(skill.planPath, 'utf8')), plan);
  assert.equal(JSON.parse(await readFile(join(root, 'skills', skill.id, 'skill.json'), 'utf8')).name, 'My named skill');
});

test('refuses incomplete work and paths outside the local edit storage', async (t) => {
  const { root, jobPath, input } = await fixture(t);
  await writeFile(join(jobPath, 'manifest.json'), JSON.stringify({ supported: false }));
  await assert.rejects(snapshotEditSkill(input, root), /no reusable plan/);
  await assert.rejects(access(join(root, 'skills', input.id)));
  await assert.rejects(snapshotEditSkill({ ...input, jobPath: tmpdir() }, root), /outside/);
});
