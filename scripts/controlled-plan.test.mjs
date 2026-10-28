import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { controlledPlanSchema, validateControlledPlan, compileControlledSpec } from '../src/server/editing/controlled-plan.mjs';
import { mediaTool } from '../src/server/platform/runtime.mjs';
import { validateVectorAsset } from '../src/server/editing/vector-assets.mjs';
import { availableTextFonts } from '../src/server/editing/text-fonts.mjs';
import { validateNativeCandidate } from '../src/lib/native-edit-validation.ts';

const sample = () => ({ version: 2, summary: 'Editable zoom and title', source: { scale: 1, x: 0, y: 0, rotation: 0, opacity: 1, volume: 0.8,
  keyframes: [{ property: 'scale', time: 0, value: 1, easing: 'linear' }, { property: 'scale', time: 1, value: 1.2, easing: 'ease-out' }] },
  texts: [{ text: 'Literal $(no command) <script>caption</script>', start: 0, duration: 1, fontSizePx: 36, color: '#FFFFFF', scale: 1, x: 0, y: -0.5, rotation: 0, opacity: 1, keyframes: [] }],
  techniques: [{ id: 'zoom', name: 'Zoom and title', start: 0, end: 1, evidence: 'Requested test', confidence: 1 }], unsupported: [] });
test('controlled plans reject executable/path fields, invalid timing and duplicate keyframes', () => {
  const plan = sample(); assert.equal(validateControlledPlan(plan, 1).version, 2); assert.equal(controlledPlanSchema.additionalProperties, false);
  assert.throws(() => validateControlledPlan({ ...plan, command: 'do something' }, 1), /fields/);
  assert.throws(() => validateControlledPlan({ ...plan, source: { ...plan.source, path: '/private/data' } }, 1), /fields/);
  const bad = sample(); bad.texts[0].duration = 2; assert.throws(() => validateControlledPlan(bad, 1), /duration/);
  const duplicate = sample(); duplicate.source.keyframes.push(duplicate.source.keyframes[0]); assert.throws(() => validateControlledPlan(duplicate, 1), /Duplicate/);
});
test('compiler keeps words as data and emits native scale-axis keyframes', () => {
  const plan = sample(), spec = compileControlledSpec(plan, { source: '/trusted/source.mp4', duration: 1, width: 640, height: 360 });
  assert.equal(spec.tracks[1].items[0].text, plan.texts[0].text);
  assert.deepEqual([...new Set(spec.operations.map(item => item.property))], ['scale_x', 'scale_y']);
  assert.equal(spec.tracks[0].items[0].path, '/trusted/source.mp4');
});

test('overlapping editable text copies compile onto independent native tracks', () => {
  const plan = sample();
  plan.texts.push({ ...plan.texts[0], x: .1, opacity: .3 });
  const spec = compileControlledSpec(plan, { source: '/trusted/source.mp4', duration: 1, width: 640, height: 360 });
  const tracks = spec.tracks.filter(track => track.type === 'text');
  assert.equal(tracks.length, 2);
  assert.equal(new Set(tracks.map(track => track.name)).size, 2);
  assert.deepEqual(tracks.map(track => track.items[0].ref), ['text-0', 'text-1']);
  assert.ok(tracks.every(track => track.items.length === 1));
});

test('sequential captions reuse tracks while concurrent text keeps its declared stacking order', () => {
  const plan = sample(), base = plan.texts[0];
  plan.texts = Array.from({ length: 200 }, (_, start) => ({ ...base, start, duration: 1 }));
  let spec = compileControlledSpec(plan, { source: '/trusted/source.mp4', duration: 200, width: 640, height: 360 });
  assert.equal(spec.tracks.filter(track => track.type === 'text').length, 1);
  assert.equal(spec.tracks.find(track => track.type === 'text').items.length, 200);
  plan.texts = [0, 1, 2, 4].map(start => ({ ...base, start, duration: 2 }));
  spec = compileControlledSpec(plan, { source: '/trusted/source.mp4', duration: 6, width: 640, height: 360 });
  assert.deepEqual(spec.tracks.filter(track => track.type === 'text').map(track => track.items.map(item => item.ref)),
    [['text-0', 'text-3'], ['text-1'], ['text-2']]);
  plan.texts = [{ ...base, start: .0000004, duration: 1.0000004 }, { ...base, start: 1.0000004, duration: 1 }];
  spec = compileControlledSpec(plan, { source: '/trusted/source.mp4', duration: 3, width: 640, height: 360 });
  assert.equal(spec.tracks.filter(track => track.type === 'text').length, 2, 'match compiler rounding for a one-microsecond overlap');
});

test('local vector generation accepts reusable shapes and rejects scripts, external resources and baked words', () => {
  const asset = { id: 'decorative-art', width: 512, height: 256, svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 256"><path d="M20 20 H490 V230 H20 Z" fill="#FFFFFF"/></svg>' };
  assert.equal(validateVectorAsset(asset).id, asset.id);
  for (const payload of ['<script>alert(1)</script>', '<image href="file:///private/file"/>', '<text>Not native text</text>', '<foreignObject/>']) assert.throws(() => validateVectorAsset({ ...asset, svg: `<svg xmlns="http://www.w3.org/2000/svg">${payload}</svg>` }), /Vector|vector|Unsupported/);
});
test('trusted compiler creates an editable native candidate from a validated plan', async t => {
  let ffmpeg; try { ffmpeg = mediaTool('ffmpeg'); } catch { t.skip('FFmpeg is required for the media integration fixture'); return; }
  const run = promisify(execFile), root = process.cwd();
  const jobs = join(root, '.local-tools', 'native-assets'), staging = join(root, '.local-tools', 'staging');
  await mkdir(jobs, { recursive: true }); await mkdir(staging, { recursive: true });
  const job = await mkdtemp(join(jobs, 'test-controlled-')), group = await mkdtemp(join(staging, 'test-controlled-'));
  t.after(async () => { await rm(job, { recursive: true, force: true }); await rm(group, { recursive: true, force: true }); });
  const source = join(job, 'raw.mp4');
  await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=640x360:r=30:d=1', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', source], { windowsHide: true, timeout: 30000 });
  const { initDraft } = await import('../toolchain/node_modules/capcut-cli/dist/factory.js');
  const { loadDraft } = await import('../toolchain/node_modules/capcut-cli/dist/draft.js');
  const { draftPath } = initDraft({ name: 'candidate', draftsDir: group, templateDir: join(root, 'toolchain', 'node_modules', 'capcut-cli', 'templates', '_init') });
  const original = loadDraft(draftPath).draft;
  await writeFile(join(job, 'original-draft.json'), JSON.stringify(original));
  await writeFile(join(job, 'spec.json'), JSON.stringify({ source: { path: source, duration: 1, width: 640, height: 360, fps: 30 } }));
  await writeFile(join(job, 'controlled-plan-1.json'), JSON.stringify(sample()));
  await run(process.execPath, [join(root, 'scripts', 'compile-controlled-edit.mjs'), job, draftPath, '1'], { cwd: root, timeout: 30000, windowsHide: true });
  const result = loadDraft(draftPath).draft;
  const video = result.tracks.find(track => track.type === 'video' && track.segments.length);
  assert.equal(result.duration, 1000000); assert.equal(video.segments[0].common_keyframes.length, 2);
  assert.equal(result.materials.videos[0].path, source);
  assert.equal(result.materials.texts.length, 1);
  assert.ok(result.materials.texts[0].content.includes('Literal'));
  assert.equal(JSON.parse(await readFile(join(job, 'manifest-1.json'), 'utf8')).supported, true);
  const expanded = { ...sample(), version: 3,
    texts: sample().texts.map(text => ({ ...text, bold: true, italic: false, ...(availableTextFonts()[0] ? { font: availableTextFonts()[0].id } : {}) })),
    assets: [{ id: 'decorative-art', width: 512, height: 256, svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 256"><ellipse cx="256" cy="128" rx="250" ry="120" fill="#FFFFFF"/></svg>' }],
    overlays: [{ assetId: 'decorative-art', start: 0, duration: 1, sourceStart: 0, scale: 0.4, x: 0, y: 0.3, rotation: 0, opacity: 1, volume: 0, blendMode: 'normal', keyframes: [] }],
    effects: [{ slug: 'chromatic', target: 'source', start: 0.1, duration: 0.4, intensity: 0.5, params: [] },
      { slug: 'motion-blur', target: 'overlay-0', start: 0.1, duration: 0.4, intensity: 0.3, params: [] }], resourceQueries: [] };
  expanded.texts[0].text = 'Editable';
  expanded.texts.push({ ...expanded.texts[0], x: .1, opacity: .3 });
  const effectFolder = join(job, 'native-resources', '7399468627948440838');
  await mkdir(effectFolder, { recursive: true });
  await writeFile(join(effectFolder, 'extra.json'), '{}');
  await writeFile(join(job, 'native-effect-bindings-2.json'), JSON.stringify({ version: 1, provider: 'official-capcut-local-builder', bindings: [{
    index: 1, slug: 'motion-blur', source: 'vimo://7399468627948440838', resourceId: '7399468627948440838', effectId: '7399468627948440838', localPath: effectFolder,
    controls: [{ name: 'effects_adjust_horizontal_shift', value: 0.7, default_value: 0.7 }, { name: 'effects_adjust_intensity', value: 0.85, default_value: 0.85 }],
    exactNativeTiming: { start: 100000, duration: 400000 },
  }] }));
  await writeFile(join(job, 'controlled-plan-2.json'), JSON.stringify(expanded));
  await run(process.execPath, [join(root, 'scripts', 'compile-controlled-edit.mjs'), job, draftPath, '2'], { cwd: root, timeout: 30000, windowsHide: true });
  const built = loadDraft(draftPath).draft;
  const manifest = JSON.parse(await readFile(join(job, 'manifest-2.json'), 'utf8'));
  assert.deepEqual(manifest.limitations, [], 'missing native evidence does not become a compiler failure');
  assert.ok(manifest.verificationGaps.some(gap => gap.includes('chromatic')), 'unknown resource availability remains a mandatory review gap');
  const validation = { original, candidate: built, manifest, analysis: { techniques: expanded.techniques }, start: 0, duration: 1_000_000,
    candidatePath: draftPath, sourcePaths: [source], width: 640, height: 360 };
  await validateNativeCandidate(validation);
  await assert.rejects(validateNativeCandidate({ ...validation, manifest: { ...manifest, limitations: ['Native construction failed.'] } }), /Native construction failed/);
  const photo = built.materials.videos.find(material => material.path.endsWith('decorative-art.png'));
  assert.ok(photo, 'generated art is an independent image dependency');
  assert.equal(built.materials.texts.length, 2, 'simultaneous words remain separate editable text');
  assert.equal(built.tracks.filter(track => track.type === 'text' && track.segments.length).length, 2);
  const nativeStyle = JSON.parse(built.materials.texts[0].content).styles[0];
  assert.equal(nativeStyle.bold, true);
  if (availableTextFonts()[0]) assert.equal(nativeStyle.font.path, availableTextFonts()[0].path);
  assert.ok(built.materials.videos.every(material => (material.check_flag & 8) === 8), 'native opacity/blend controls are enabled');
  assert.ok((await readFile(photo.path.replace(/\.png$/, '.svg'), 'utf8')).includes('<ellipse'));
  const effect = Object.values(built.materials).flat().find(material => material.type === 'video_effect');
  assert.equal(effect.apply_target_type, 0);
  assert.equal(effect.bind_segment_id, built.tracks.find(track => track.type === 'video').segments[0].id);
  assert.equal(built.materials.videos.find(material => material.id !== photo.id).path, source);
  assert.equal(built.tracks.filter(track => track.type === 'effect').length, 2, 'simultaneous effects use independent native tracks');
  const official = built.materials.video_effects.find(material => material.resource_id === '7399468627948440838');
  assert.equal(official.path, effectFolder);
  assert.deepEqual(official.adjust_params.map(control => [control.name, control.value]), [['effects_adjust_horizontal_shift', 0.7], ['effects_adjust_intensity', 0.85]], 'actual plugin control fields reach the editable native component');
  const lint = await run(process.execPath, [join(root, 'toolchain', 'node_modules', 'capcut-cli', 'dist', 'index.js'), 'lint', draftPath, '--json'], { cwd: root, timeout: 30000, windowsHide: true });
  assert.ok(!JSON.parse(lint.stdout).issues?.some(issue => issue.code === 'caption-overlap'));
  assert.equal(JSON.parse(lint.stdout).summary.errors, 0);
  await run(process.execPath, [join(root, 'scripts', 'render-preview.mjs'), job, draftPath], { cwd: root, timeout: 30000, windowsHide: true });
  const proxy = JSON.parse(await readFile(join(job, 'preview-plan.json'), 'utf8'));
  assert.equal(proxy.audioSegments, 1, 'embedded source audio is included in the preview');
  assert.equal(proxy.textOverlays, 2);
  assert.equal(proxy.overlaySegments, 1);
  assert.equal(proxy.previewKind, 'approximate');
  const output = JSON.parse((await run(mediaTool('ffprobe'), ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', join(job, 'preview.mp4')], { windowsHide: true })).stdout);
  assert.ok(output.streams.some(stream => stream.codec_type === 'audio'));
  assert.ok(Math.abs(Number(output.format.duration) - 1) < 0.05);
  await run(process.execPath, [join(root, 'scripts', 'compile-controlled-edit.mjs'), job, draftPath, '2'], { cwd: root, timeout: 30000, windowsHide: true });
  assert.equal(loadDraft(draftPath).draft.materials.videos.find(material => material.path.endsWith('decorative-art.png')).path, photo.path, 'unchanged assets reuse the checked cached artifact');
  const globalPlan = structuredClone(expanded);
  globalPlan.effects.forEach(effect => effect.target = 'composition');
  const compileComposition = async round => {
    await writeFile(join(job, `controlled-plan-${round}.json`), JSON.stringify(globalPlan));
    await writeFile(join(job, `native-effect-bindings-${round}.json`), await readFile(join(job, 'native-effect-bindings-2.json')));
    await run(process.execPath, [join(root, 'scripts/compile-controlled-edit.mjs'), job, draftPath, String(round)], { cwd: root, timeout: 30000, windowsHide: true });
    const candidate = loadDraft(draftPath).draft;
    const receipt = JSON.parse(await readFile(join(job, `execution-${round}.json`), 'utf8'));
    return { candidate, manifest: JSON.parse(await readFile(join(job, `manifest-${round}.json`), 'utf8')),
      compositionEffectIds: receipt.operations.filter(op => op.scope === 'composition').map(op => op.materialId) };
  };
  const whole = await compileComposition(3);
  await assert.rejects(validateNativeCandidate({ ...validation, ...whole, compositionEffectIds: [] }), /Isolate or bind/);
  await validateNativeCandidate({ ...validation, ...whole });
  assert.ok(whole.candidate.materials.video_effects.every(effect => effect.apply_target_type === 2));
  const selectedOriginal = structuredClone(result);
  selectedOriginal.tracks = selectedOriginal.tracks.filter(track => track.type === 'video');
  const clipId = selectedOriginal.tracks.find(track => track.segments.length).segments[0].id;
  await writeFile(join(job, 'original-draft.json'), JSON.stringify(selectedOriginal));
  await writeFile(join(job, 'spec.json'), JSON.stringify({ source: { path: source, duration: 1, width: 640, height: 360, fps: 30, clipId } }));
  const scoped = await compileComposition(4);
  await validateNativeCandidate({ ...validation, ...scoped, original: selectedOriginal, clipId });
  const unrelated = structuredClone(result.tracks.find(track => track.type === 'text'));
  const conflictingOriginal = { ...selectedOriginal, tracks: [...selectedOriginal.tracks, unrelated] };
  await writeFile(join(job, 'original-draft.json'), JSON.stringify(conflictingOriginal));
  const beforeRefusal = await readFile(join(draftPath, 'draft_content.json'), 'utf8');
  await assert.rejects(compileComposition(4), /unrelated original/);
  assert.equal(await readFile(join(draftPath, 'draft_content.json'), 'utf8'), beforeRefusal);
});

test('candidate identity updates every active timeline mirror and preserves inactive timelines and envelopes', async t => {
  const run = promisify(execFile), root = process.cwd(), staging = join(root, '.local-tools/staging');
  await mkdir(staging, { recursive: true });
  const group = await mkdtemp(join(staging, 'test-identity-'));
  t.after(() => rm(group, { recursive: true, force: true }));
  const { initDraft } = await import('../toolchain/node_modules/capcut-cli/dist/factory.js');
  const { loadDraft } = await import('../toolchain/node_modules/capcut-cli/dist/draft.js');
  const { parseCandidate } = await import('../toolchain/node_modules/capcut-cli/dist/store.js');
  const { draftPath } = initDraft({ name: 'nested', draftsDir: group, templateDir: join(root, 'toolchain/node_modules/capcut-cli/templates/_init') });
  const baseline = loadDraft(draftPath).draft;
  const selected = join(draftPath, 'Timelines', 'selected');
  const inactive = join(draftPath, 'Timelines', 'inactive');
  await mkdir(selected, { recursive: true }); await mkdir(inactive, { recursive: true });
  await writeFile(join(draftPath, 'template-2.tmp'), JSON.stringify({ wrapper: { draft_content: JSON.stringify(baseline) }, sentinel: 'root envelope' }));
  await writeFile(join(selected, 'draft_content.json'), JSON.stringify(baseline));
  await writeFile(join(selected, 'template-2.tmp'), JSON.stringify({ content: { ...baseline, id: 'old-mirror-guid' }, sentinel: 'nested envelope' }));
  const inactiveBytes = JSON.stringify({ ...baseline, name: 'Leave this timeline alone' });
  await writeFile(join(inactive, 'draft_info.json'), inactiveBytes);
  await writeFile(join(draftPath, 'Timelines/project.json'), JSON.stringify({ main_timeline_id: 'selected', timelines: [{ id: 'selected' }, { id: 'inactive' }] }));
  for (let attempt = 0; attempt < 2; attempt++) {
    await run(process.execPath, [join(root, 'scripts/capcut-draft.mjs'), 'isolate', draftPath], { cwd: root, windowsHide: true, timeout: 30000 });
    const pointer = JSON.parse(await readFile(join(draftPath, 'Timelines/project.json'), 'utf8'));
    const selectedFolder = join(draftPath, 'Timelines', pointer.main_timeline_id);
    const loaded = loadDraft(draftPath, { activeTimeline: true }).draft;
    assert.equal(loaded.id, pointer.main_timeline_id);
    assert.match(loaded.name, /^AI Editor review /);
    for (const path of [join(selectedFolder, 'draft_content.json'), join(selectedFolder, 'template-2.tmp'), join(draftPath, 'draft_content.json'), join(draftPath, 'template-2.tmp')])
      assert.equal(parseCandidate(path).draft.name, loaded.name);
    assert.equal(JSON.parse(await readFile(join(selectedFolder, 'template-2.tmp'), 'utf8')).sentinel, 'nested envelope');
    assert.equal(JSON.parse(await readFile(join(draftPath, 'template-2.tmp'), 'utf8')).sentinel, 'root envelope');
    assert.equal(await readFile(join(inactive, 'draft_info.json'), 'utf8'), inactiveBytes);
  }
  const pointer = JSON.parse(await readFile(join(draftPath, 'Timelines/project.json'), 'utf8'));
  const conflict = join(draftPath, 'Timelines', pointer.main_timeline_id, 'draft_content.json');
  const changed = JSON.parse(await readFile(conflict, 'utf8')); changed.duration += 1;
  const changedBytes = JSON.stringify(changed); await writeFile(conflict, changedBytes);
  await assert.rejects(run(process.execPath, [join(root, 'scripts/capcut-draft.mjs'), 'isolate', draftPath], { cwd: root, windowsHide: true, timeout: 30000 }), /documents disagree/);
  assert.equal(await readFile(conflict, 'utf8'), changedBytes, 'real content conflicts are never silently reconciled');
});
