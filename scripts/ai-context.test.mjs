import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { loadRoleInstructions } from '../src/server/codex/context.mjs';
import { referenceEvidenceContext } from '../src/server/editing/reference-context.mjs';

test('roles load their actual editing guides; reviewers avoid the authoring catalog', async () => {
  const root = join(process.cwd(), 'ai');
  const editor = await loadRoleInstructions(root, 'editor');
  const reviewer = await loadRoleInstructions(root, 'reviewer');
  assert.ok(editor.sources.some(file => file.path === 'tools/assets-and-motion.md'));
  assert.ok(editor.sources.some(file => file.path === 'tools/capcut-cli.md'));
  assert.ok(editor.text.includes('Create missing assets'));
  assert.ok(reviewer.sources.some(file => file.path === 'workflows/verification.md'));
  assert.ok(!reviewer.sources.some(file => file.path === 'tools/assets-and-motion.md'));
  for (const role of ['editor', 'motion', 'captions', 'audio']) {
    const instructions = await loadRoleInstructions(root, role);
    assert.ok(instructions.sources.some(file => file.path === 'tools/official-capcut.md'), `${role} needs the official operation boundaries`);
  }
  assert.ok(editor.sources.every(file => /^[0-9a-f]{64}$/.test(file.sha256)));
  await assert.rejects(loadRoleInstructions(root, '../private'), /Unknown/);
});

test('missing or escaping guide references fail before a worker starts', async t => {
  const base = join(process.cwd(), '.local-tools', 'context-tests'); await mkdir(base, { recursive: true });
  const folder = await mkdtemp(join(base, 'run-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  await writeFile(join(folder, 'context-index.json'), JSON.stringify({ version: 1, shared: ['missing.md'], roles: { editor: [] } }));
  await assert.rejects(loadRoleInstructions(folder, 'editor'), /ENOENT/);
  await writeFile(join(folder, 'context-index.json'), JSON.stringify({ version: 1, shared: ['../private.md'], roles: { editor: [] } }));
  await assert.rejects(loadRoleInstructions(folder, 'editor'), /Invalid AI context/);
});

test('contact sheets include exact frame times and distinguish audio extraction from listening', () => {
  const frames = Array.from({ length: 66 }, (_, index) => ({ time: index / 30 }));
  const evidence = JSON.parse(referenceEvidenceContext({ frames: ['sheet1', 'sheet2'] }, {
    duration: 2.2, nativeFps: 30, sampleFps: 30, sampling: 'consecutive', audioPath: 'audio.wav', frames,
    sheets: [{ path: 'sheet1', firstFrame: 1, layout: '6x6 row-major' }, { path: 'sheet2', firstFrame: 37, layout: '6x6 row-major' }],
  }));
  assert.equal(evidence.sheets[1].timesSeconds[0], 1.2);
  assert.equal(evidence.sheets[1].timesSeconds.length, 30);
  assert.equal(evidence.audioExtracted, true);
  assert.ok(evidence.audioEvidence.includes('not a transcript'));
  assert.ok(referenceEvidenceContext({ frames: [] }).includes('Reference: none'));
});

test('offline inventory discovers actual command contracts and native keyframe properties', async () => {
  const { stdout } = await promisify(execFile)(process.execPath, ['scripts/inspect-editing-tools.mjs'], { cwd: process.cwd(), windowsHide: true, timeout: 30000, maxBuffer: 2_000_000 });
  const inventory = JSON.parse(stdout);
  assert.ok(inventory.capcut.commands.commands.some(command => command.name === 'bubble-text'));
  assert.ok(inventory.capcut.commands.commands.some(command => command.name === 'add-effect'));
  assert.ok(inventory.capcut.keyframes.includes('brightness'));
  assert.ok(inventory.capcut.catalogs.scene_effects.length > 0);
  if (inventory.ffmpeg.verified) assert.ok(inventory.ffmpeg.filters.includes('overlay'));
  assert.equal(inventory.applicationAdapter.planVersion, 5);
  assert.ok(inventory.applicationAdapter.gaps.length > 0);
});
