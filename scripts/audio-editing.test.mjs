import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { validateAudioPlan } from '../src/server/editing/audio-plan.mjs';
import { renderAudioAssets, synthesizeAudio, audioRate } from '../src/server/editing/audio-synthesis.mjs';
import { renderNativeAudio, mixNativeTrack, includeAudioDefects } from '../src/server/editing/audio-mix.mjs';
import { validateControlledPlan, soundDesignPlanSchema } from '../src/server/editing/controlled-plan.mjs';
import { mediaTool } from '../src/server/platform/runtime.mjs';
import { validateNativeCandidate } from '../src/lib/native-edit-validation.ts';

const sound = () => ({ decision: 'augment', rationale: 'A quiet rising accent supports the opening push; preserve the original tone.',
  assets: [{ id: 'rise', duration: 0.8, seed: 7, layers: [{ wave: 'sine', start: 0, duration: 0.8, frequency: 220, endFrequency: 880, gain: 0.3, attack: 0.05, release: 0.2, pan: 0 }] }],
  clips: [{ assetId: 'rise', role: 'sfx', reason: 'Accent the push without masking the original.', start: 0.1, duration: 0.8, sourceStart: 0, volume: 0.3,
    keyframes: [{ property: 'volume', time: 0, value: 0.3, easing: 'linear' }, { property: 'volume', time: 0.7, value: 0, easing: 'ease-out' }] }] });
const plan = () => ({ version: 5, summary: 'Editable rising sound under intact source audio.',
  source: { scale: 1, x: 0, y: 0, rotation: 0, opacity: 1, volume: 1, keyframes: [] }, texts: [], assets: [], overlays: [], effects: [], resourceQueries: [], unsupported: [], audio: sound(),
  techniques: [{ id: 'sound', name: 'Opening accent', start: 0.1, end: 0.9, evidence: 'Requested fixture', confidence: 1, components: ['audio-0'], expectedBehavior: 'Quiet rising accent with a smooth tail.', checks: ['Audio starts at .1 seconds and retains volume keys.'] }] });

test('sound plans are bounded, non-executable and explicitly preserve or augment', () => {
  assert.equal(validateControlledPlan(plan(), 1).version, 5); assert.ok(soundDesignPlanSchema.required.includes('audio'));
  for (const change of [audio => { audio.assets[0].url = 'https://invalid.test/song'; }, audio => { audio.assets[0].layers[0].wave = 'exec'; },
    audio => { audio.decision = 'preserve'; }, audio => { audio.clips[0].duration = 5; }, audio => { audio.assets[0].layers[0].release = 1; }]) {
    const value = sound(); change(value); assert.throws(() => validateAudioPlan(value, 1));
  }
  assert.equal(validateAudioPlan({ decision: 'preserve', rationale: 'Dialogue needs room.', assets: [], clips: [] }, 1).decision, 'preserve');
  const first = synthesizeAudio(sound().assets[0]), next = synthesizeAudio(sound().assets[0]);
  assert.deepEqual(first.wav, next.wav); assert.ok(first.peak > 0.05 && first.peak <= 0.85);
  assert.equal(first.wav.readUInt32LE(24), 48000); assert.equal(first.wav.readUInt16LE(22), 2);
  assert.equal(first.wav.length, 44 + Math.round(0.8 * 48000) * 4);
  assert.equal(first.wav.readInt16LE(44), 0); assert.ok(Math.abs(first.wav.readInt16LE(first.wav.length - 2)) < 4);
});

test('saved volume curves affect preview samples and clipping cannot be approved away', () => {
  const mix = new Float32Array(audioRate * 2), decoded = new Float32Array(audioRate * 2).fill(0.5);
  const segment = { target_timerange: { start: 0 }, volume: 1, common_keyframes: [{ property_type: 'KFTypeVolume', keyframe_list: [{ time_offset: 0, values: [1] }, { time_offset: 1000000, values: [0] }] }] };
  mixNativeTrack(mix, decoded, segment, { start: 0, duration: 1, timelineStart: 0 });
  assert.equal(mix[0], .5); assert.ok(Math.abs(mix[audioRate] - .25) < .0001); assert.ok(mix.at(-1) < .0001);
  const findings = { decision: 'ready', defects: [], techniques: [{ id: 'motion', status: 'matched' }, { id: 'sound', status: 'matched' }] };
  const result = includeAudioDefects(findings, { clippedSamples: 50, peak: 1.5, tracks: [{ component: 'audio-0', peak: .4, decodedSeconds: 1, duration: 1 }] }, [{ id: 'motion', components: ['source'] }, { id: 'sound', components: ['audio-0'] }]);
  assert.equal(result.decision, 'revise'); assert.equal(result.techniques[0].status, 'matched'); assert.equal(result.techniques[1].status, 'defect');
});

test('generated audio compiles to independent native tracks, preserves source sound and mixes actual saved controls', async t => {
  const root = process.cwd(), run = promisify(execFile), jobs = join(root, '.local-tools/native-assets'), stages = join(root, '.local-tools/staging');
  await mkdir(jobs, { recursive: true }); await mkdir(stages, { recursive: true });
  const job = await mkdtemp(join(jobs, 'test-audio-')), group = await mkdtemp(join(stages, 'test-audio-'));
  t.after(async () => { await rm(job, { recursive: true, force: true }); await rm(group, { recursive: true, force: true }); });
  const source = join(job, 'raw.mp4');
  await run(mediaTool('ffmpeg'), ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=320x180:r=30:d=1', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', source], { windowsHide: true, timeout: 30000 });
  const sourceHash = createHash('sha256').update(await readFile(source)).digest('hex');
  const { initDraft } = await import('../toolchain/node_modules/capcut-cli/dist/factory.js');
  const { loadDraft } = await import('../toolchain/node_modules/capcut-cli/dist/draft.js');
  const { draftPath: candidate } = initDraft({ name: 'candidate', draftsDir: group, templateDir: join(root, 'toolchain/node_modules/capcut-cli/templates/_init') });
  const original = loadDraft(candidate).draft;
  await writeFile(join(job, 'original-draft.json'), JSON.stringify(original));
  await writeFile(join(job, 'spec.json'), JSON.stringify({ source: { path: source, duration: 1, width: 320, height: 180, fps: 30 } }));
  await writeFile(join(job, 'controlled-plan-1.json'), JSON.stringify(plan()));
  await run(process.execPath, [join(root, 'scripts/compile-controlled-edit.mjs'), job, candidate, '1'], { cwd: root, windowsHide: true, timeout: 30000 });
  const draft = loadDraft(candidate).draft, execution = JSON.parse(await readFile(join(job, 'execution-1.json')));
  const segment = draft.tracks.find(track => track.type === 'audio' && track.segments.length).segments[0];
  assert.equal(segment.target_timerange.start, 100000); assert.equal(segment.common_keyframes[0].property_type, 'KFTypeVolume');
  assert.equal(segment.common_keyframes[0].keyframe_list.length, 2);
  const file = draft.materials.audios.find(item => item.id === segment.material_id).path;
  assert.ok(file.endsWith('.wav')); assert.ok(JSON.parse(await readFile(file.replace('.wav', '.source.json'))).asset.layers.length);
  const manifest = JSON.parse(await readFile(join(job, 'manifest-1.json')));
  await validateNativeCandidate({ original, candidate: draft, manifest, analysis: { techniques: plan().techniques }, start: 0, duration: 1000000, candidatePath: candidate, sourcePaths: [source], width: 320, height: 180 });
  const { path, report } = await renderNativeAudio({ draft, original, job, candidate, duration: 1, refs: execution.refs });
  assert.equal(report.tracks.length, 2); assert.ok(report.tracks.some(track => track.component === 'source' && track.peak > .01));
  assert.ok(report.tracks.some(track => track.component === 'audio-0' && track.volumeKeys === 2 && track.peak > .01));
  assert.equal(report.clippedSamples, 0); assert.equal(report.nativeVerified, false);
  const probe = JSON.parse((await run(mediaTool('ffprobe'), ['-v', 'error', '-show_streams', '-of', 'json', path], { windowsHide: true })).stdout);
  assert.equal(probe.streams[0].sample_rate, '48000'); assert.equal(probe.streams[0].channels, 2);
  assert.equal(createHash('sha256').update(await readFile(source)).digest('hex'), sourceHash);
  assert.equal(await readFile(join(job, 'original-draft.json'), 'utf8'), JSON.stringify(original));
  // A partial cache with a linked destination must never overwrite another file.
  const destination = join(job, 'untouched.wav'); await writeFile(destination, 'untouched'); await unlink(file); await unlink(file.replace('.wav', '.source.json'));
  try { await symlink(destination, file); } catch (error) { if (error.code === 'EPERM') { t.diagnostic('Symlink privilege unavailable; platform link test omitted.'); return; } throw error; }
  await assert.rejects(renderAudioAssets(sound(), job, 1), /Linked/); assert.equal(await readFile(destination, 'utf8'), 'untouched');
});
