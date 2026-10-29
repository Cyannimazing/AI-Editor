import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
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

// Model the observed Unix pipe/early-exit boundary without depending on the
// host pipe capacity. All commands still use the real pinned CLI and inventory.
async function inventoryWithOutput(t, mode) {
  const base = join(process.cwd(), '.local-tools', 'context-tests'); await mkdir(base, { recursive: true });
  const folder = await mkdtemp(join(base, 'stdout-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const preload = join(folder, 'output.mjs');
  await writeFile(preload, `import { writeSync } from 'node:fs';
if (process.argv[1]?.replaceAll('\\\\', '/').endsWith('/capcut-cli/dist/index.js') && process.argv.includes('describe')) {
  process.stdout.write = value => {
    const data = JSON.parse(value);
    if (${JSON.stringify(mode)}.startsWith('large')) data.commands[0].summary = 'complete-contract-'.repeat(5000);
    let output = JSON.stringify(data);
    if (${JSON.stringify(mode)} === 'invalid' || (${JSON.stringify(mode)} === 'pipe-exit' && !process.argv.includes('--compact'))) {
      if (output.length < 65536) output = JSON.stringify({ ...data, padding: 'x'.repeat(70000) });
      output = Buffer.from(output).subarray(0, 65536);
    }
    const bytes = Buffer.from(output); let offset = 0, injectedBackpressure = false;
    // Node's Unix stdout pipe can be nonblocking even with writeSync. Keep the
    // fixture synchronous for the CLI's immediate exit, but bound backpressure.
    const deadline = Date.now() + 5000, waitBuffer = new Int32Array(new SharedArrayBuffer(4));
    while (offset < bytes.length) {
      try {
        if (${JSON.stringify(mode)} === 'large-backpressure' && offset > 0 && !injectedBackpressure) {
          injectedBackpressure = true;
          throw Object.assign(new Error('Injected pipe backpressure'), { code: 'EAGAIN' });
        }
        offset += writeSync(1, bytes, offset, Math.min(16384, bytes.length - offset));
      } catch (error) {
        if (!['EAGAIN', 'EWOULDBLOCK'].includes(error.code) || Date.now() >= deadline) throw error;
        Atomics.wait(waitBuffer, 0, 0, 1);
      }
    }
    return true;
  };
}
`);
  return promisify(execFile)(process.execPath, ['scripts/inspect-editing-tools.mjs'], {
    cwd: process.cwd(), timeout: 30000, windowsHide: true, maxBuffer: 2_000_000,
    env: { ...process.env, NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --import=${pathToFileURL(preload).href}` },
  });
}

test('inventory uses the complete compact index when a full CLI contract would be truncated at exit', async t => {
  const { stdout } = await inventoryWithOutput(t, 'pipe-exit');
  const inventory = JSON.parse(stdout);
  assert.ok(inventory.capcut.commands.commands.some(command => command.name === 'bubble-text'));
  assert.ok(inventory.capcut.commands.commands.some(command => command.name === 'add-effect'));
});

test('inventory accepts a complete contract larger than 64 KiB', async t => {
  const { stdout } = await inventoryWithOutput(t, 'large');
  const inventory = JSON.parse(stdout);
  assert.equal(inventory.capcut.commands.commands[0].summary.length, 90000);
  assert.ok(inventory.capcut.commands.commands.some(command => command.name === 'add-effect'));
});

test('large contract fixture survives pipe backpressure after a partial write', async t => {
  const { stdout } = await inventoryWithOutput(t, 'large-backpressure');
  const inventory = JSON.parse(stdout);
  assert.equal(inventory.capcut.commands.commands[0].summary.length, 90000);
  assert.ok(inventory.capcut.commands.commands.some(command => command.name === 'add-effect'));
});

test('inventory rejects truncated contracts with a producer and byte count diagnostic', async t => {
  await assert.rejects(inventoryWithOutput(t, 'invalid'), error => {
    assert.match(error.stderr, /CapCut describe.*65536 bytes.*invalid or incomplete JSON/);
    assert.ok(error.stderr.length < 5000, 'Do not dump the command payload into diagnostics.');
    return true;
  });
});
