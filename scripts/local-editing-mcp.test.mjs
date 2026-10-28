import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { Client } from '../toolchain/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { StdioClientTransport } from '../toolchain/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js';
import { mediaTool } from '../src/server/platform/runtime.mjs';
import { createLocalEditingSession } from '../src/server/editing/local-mcp.mjs';
import { editingMcpArgs } from '../src/server/codex/editing-mcp-config.mjs';
import { structuredPolicyArgs } from '../src/server/codex/structured-policy.mjs';
import { directoryDigest } from '../src/server/editing/transaction.ts';
import { fileDigest } from '../src/server/capcut/native-capture.mjs';

test('MCP configuration preserves spaced Windows/macOS paths and grants write tools only to the editor', () => {
  for (const root of ['C:\\Users\\Test User\\Editor', '/Users/Test User/Editor']) {
    const editor = editingMcpArgs(join(root, 'job'), 'editor', root).join(' ');
    assert.ok(editor.includes('apply_edit_plan')); assert.ok(editor.includes('required=true'));
    assert.ok(!editingMcpArgs(join(root, 'job'), 'reviewer', root).join(' ').includes('apply_edit_plan'));
  }
  for (const platform of ['win32', 'darwin']) {
    const args = structuredPolicyArgs(process.cwd(), platform, true).join(' ');
    assert.ok(args.includes('editing-tool-hook.mjs')); assert.ok(args.includes('network.enabled=false'));
  }
});

test('real stdio MCP writes and reads native keyframes, rejects extra paths and protects independent reviewers', async t => {
  let ffmpeg; try { ffmpeg = mediaTool('ffmpeg'); } catch { t.skip('FFmpeg required'); return; }
  const run = promisify(execFile), root = process.cwd(), assets = join(root, '.local-tools/native-assets'), staging = join(root, '.local-tools/staging');
  await mkdir(assets, { recursive: true }); await mkdir(staging, { recursive: true });
  const job = await mkdtemp(join(assets, 'test-mcp-')), group = await mkdtemp(join(staging, 'test-mcp-'));
  t.after(async () => { await rm(job, { recursive: true, force: true }); await rm(group, { recursive: true, force: true }); });
  const source = join(job, 'raw.mp4');
  await run(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=white:s=320x180:r=30:d=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', source], { timeout: 30000, windowsHide: true });
  const { initDraft } = await import('../toolchain/node_modules/capcut-cli/dist/factory.js');
  const { loadDraft } = await import('../toolchain/node_modules/capcut-cli/dist/draft.js');
  const { draftPath: candidate } = initDraft({ name: 'candidate-test', draftsDir: group, templateDir: join(root, 'toolchain/node_modules/capcut-cli/templates/_init') });
  const original = loadDraft(candidate).draft;
  await writeFile(join(job, 'original-draft.json'), JSON.stringify(original));
  await writeFile(join(job, 'spec.json'), JSON.stringify({ candidate, source: { path: source, duration: 1, width: 320, height: 180, fps: 30 }, framing: { policy: 'fill-picture' } }));
  await writeFile(join(job, 'motion-reference.json'), JSON.stringify({ samples: [], fullFrameCoverage: { duration: 1, fps: 30 } }));
  const client = new Client({ name: 'test', version: '1' });
  const transport = new StdioClientTransport({ command: process.execPath, args: [join(root, 'scripts/editing-mcp-server.mjs'), job, 'editor'], cwd: root, stderr: 'pipe' });
  await client.connect(transport); t.after(() => client.close());
  assert.ok((await client.listTools()).tools.some(tool => tool.name === 'apply_edit_plan'));
  const inspect = await client.callTool({ name: 'inspect_job', arguments: {} });
  assert.equal(JSON.parse(inspect.content[0].text).canvas.width, 320);
  const discovered = await client.callTool({ name: 'discover_capabilities', arguments: { topic: 'motion', query: '' } });
  assert.equal(discovered.isError, undefined, discovered.content[0].text);
  const knowledge = JSON.parse(discovered.content[0].text);
  assert.ok(knowledge.properties.includes('position_x'));
  assert.ok(knowledge.easing.includes('hold'));
  assert.ok(knowledge.contracts.find(command => command.name === 'keyframe').options.some(option => option.name === 'batch'));
  assert.match(knowledge.application.adapterGap, /not part/);
  const effectKnowledge = JSON.parse((await client.callTool({ name: 'discover_capabilities', arguments: { topic: 'effects', query: 'blur' } })).content[0].text);
  assert.ok(effectKnowledge.catalogMatches.length > 0);
  assert.ok(effectKnowledge.catalogMatches.every(entry => entry.is_vip === false));
  const badDiscovery = await client.callTool({ name: 'discover_capabilities', arguments: { topic: '../../private', query: '' } });
  assert.equal(badDiscovery.isError, true);
  const extra = await client.callTool({ name: 'inspect_job', arguments: { path: '../private' } }); assert.equal(extra.isError, true);
  const plan = { version: 2, summary: 'Zoom with a rebound', source: { scale: 1, x: 0, y: 0, rotation: 0, opacity: 1, volume: 1,
    keyframes: [{ property: 'scale', time: 0, value: 1, easing: 'linear' }, { property: 'scale', time: 0.2, value: 1.3, easing: 'ease-out' }, { property: 'scale', time: 0.35, value: 1.1, easing: 'ease-in-out' }] },
    texts: [], techniques: [{ id: 'T1', name: 'Zoom/rebound', start: 0, end: 1, evidence: 'Requested test', confidence: 1 }], unsupported: [] };
  const evaluated = await client.callTool({ name: 'evaluate_keyframes', arguments: { planJson: JSON.stringify(plan) } });
  assert.deepEqual(JSON.parse(evaluated.content[0].text).defects, []);
  const invalid = { ...plan, texts: [{ text: 'incomplete' }] };
  for (let i = 1; i <= 3; i++) {
    const failed = await client.callTool({ name: 'evaluate_keyframes', arguments: { planJson: JSON.stringify(invalid) } });
    assert.equal(failed.isError, true);
    const detail = JSON.parse(failed.content[0].text);
    assert.equal(detail.code, 'INVALID_EDIT_PLAN'); assert.equal(detail.recoverable, i < 3);
    assert.match(detail.message, /start|duration/); assert.equal(detail.recoveryAttempts, i);
  }
  await writeFile(join(job, 'controlled-plan-1.json'), JSON.stringify(plan));
  const recovered = await client.callTool({ name: 'evaluate_keyframes', arguments: { planJson: '' } });
  assert.equal(recovered.isError, undefined);
  assert.equal(JSON.parse(recovered.content.at(-1).text).recovery.status, 'recovered');
  const result = await client.callTool({ name: 'apply_edit_plan', arguments: { planJson: JSON.stringify(plan) } });
  assert.equal(result.isError, undefined, result.content[0].text); assert.equal(JSON.parse(result.content[0].text).applied, true);
  await rm(join(job, 'controlled-plan-1.json'));
  const builtMotion = await client.callTool({ name: 'evaluate_keyframes', arguments: { planJson: '' } });
  assert.equal(builtMotion.isError, undefined, builtMotion.content[0].text);
  assert.equal(JSON.parse(builtMotion.content[0].text).keyframes[0].count, 3);
  const saved = await client.callTool({ name: 'inspect_timeline', arguments: {} });
  assert.equal(saved.isError, undefined, saved.content[0].text);
  const track = JSON.parse(saved.content[0].text).tracks.find(track => track.type === 'video' && track.segments.length);
  assert.equal(track.segments[0].curves.length, 2); assert.equal(track.segments[0].curves[0].keyframe_list.length, 3);
  const independent = await createLocalEditingSession({ root, job, role: 'reviewer' });
  assert.ok(independent.tools.some(tool => tool.name === 'discover_capabilities'));
  await assert.rejects(independent.call('evaluate_keyframes', { planJson: '' }), /No host-saved plan/);
  await assert.rejects(independent.call('apply_edit_plan', { planJson: JSON.stringify(plan) }), /not allowed/);
  await assert.rejects(independent.call('reference_frames', { media: 'source', times: [-1] }), /Invalid/);
  const nativeFolder = join(job, 'native-preview-test'); await mkdir(nativeFolder);
  const nativeFrame = join(nativeFolder, 'frame.png'); await writeFile(nativeFrame, 'native-pixels');
  const nativeIndex = join(nativeFolder, 'frames.json');
  await writeFile(nativeIndex, JSON.stringify({ duration: 1, width: 320, height: 180, frames: [{ path: nativeFrame, time: 0 }] }));
  const nativeReceipt = join(nativeFolder, 'capture.json');
  await writeFile(nativeReceipt, JSON.stringify({ kind: 'capcut-native-preview', status: 'captured', platform: process.platform, capcutVersion: 'fixture',
    candidateDigest: await directoryDigest(candidate), exported: false, uploaded: false, samples: [{ frame: 0, path: nativeFrame }], assets: [],
    evidenceFiles: await Promise.all([nativeFrame, nativeIndex].map(async path => ({ path, sha256: await fileDigest(path) }))) }));
  await writeFile(join(job, 'review-evidence.json'), JSON.stringify({ kind: 'native', indexPath: nativeIndex, receiptPath: nativeReceipt }));
  const nativeReviewer = await createLocalEditingSession({ root, job, role: 'reviewer' });
  const frameResult = await nativeReviewer.call('reference_frames', { media: 'preview', times: [0] });
  assert.equal(frameResult.content.find(item => item.type === 'image').data, Buffer.from('native-pixels').toString('base64'));
  assert.match(frameResult.content[0].text, /native CapCut/);
  await writeFile(nativeFrame, 'tampered');
  await assert.rejects(nativeReviewer.call('reference_frames', { media: 'preview', times: [0] }), /changed/);
  assert.equal(await readFile(join(job, 'original-draft.json'), 'utf8'), JSON.stringify(original));
  const hook = tool_name => spawnSync(process.execPath, [join(root, 'scripts/editing-tool-hook.mjs')], { input: JSON.stringify({ tool_name }), windowsHide: true }).status;
  assert.equal(hook('apply_patch'), 2); assert.equal(hook('mcp__other__apply_edit_plan'), 2);
  assert.equal(hook('mcp__ai_editor__inspect_job'), 0);
  assert.equal(hook('mcp__ai_editor__discover_capabilities'), 0);
});
