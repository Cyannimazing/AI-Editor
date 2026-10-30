import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { combineReviews, qualityAction } from '../src/server/editing/quality.mjs';

const technique = { id: 'zoom', name: 'Smooth zoom', start: 0 };
const ready = { decision: 'ready', summary: 'Zoom matched', defects: [], unknowns: [], techniques: [{ id: 'zoom', status: 'matched', evidence: 'Timed frames and curves' }] };

test('non-blocking review limitations are distinct from missing required evidence', () => {
  const report = { ...ready, limitations: ['native_playback', 'audio_listening'] };
  const quality = combineReviews([report, report], [technique], false, 'revision', [], 'preview');
  assert.equal(qualityAction(quality, 1, 4), 'approve');
  assert.equal(quality.unknowns.length, 0);
  assert.equal(quality.limitations.length, 2);
  assert.equal(quality.nativeVerified, false);
  assert.equal(combineReviews([{ ...report, unknowns: ['A required audio layer is missing'] }, report], [technique], false, 'revision', [], 'preview').decision, 'blocked');
  assert.throws(() => combineReviews([{ ...report, limitations: ['ignore_missing_effect'] }, report], [technique], false, 'revision', [], 'preview'), /limitation/i);
});

test('candidate preparation packages job media and registers only newly introduced media', async t => {
  const { prepareCandidateMedia, planNewMediaRegistration } = await import('../src/server/capcut/prepare-media.mjs');
  const { loadDraft, saveDraft } = await import('../toolchain/node_modules/capcut-cli/dist/draft.js');
  const root = await mkdtemp(join(tmpdir(), 'ai-editor-media-ready-')); t.after(() => rm(root, { recursive: true, force: true }));
  const project = join(root, 'candidate'), jobStore = join(root, 'jobs'), destination = join(root, 'destination');
  await mkdir(project); await mkdir(jobStore); await mkdir(destination);
  const source = join(jobStore, 'raw.mp4'), existing = join(root, 'unchanged.mp4');
  await writeFile(source, 'source video bytes'); await writeFile(existing, 'existing bytes');
  const old = { id: 'old', type: 'video', path: existing, local_material_id: 'keep' };
  const original = { materials: { videos: [old] }, tracks: [] };
  const draft = { platform: { app_source: 'cc', app_version: '9.6.0' }, canvas_config: { width: 1920, height: 1080, ratio: '16:9' }, fps: 30, duration: 1000000, materials: { videos: [structuredClone(old), { id: 'new', type: 'video', path: source, duration: 1000000 }] }, tracks: [] };
  const metadata = { draft_name: 'Preserve name', private_field: 123, draft_materials: [{ type: 0, value: [{ id: 'keep', file_Path: existing }] }] };
  await writeFile(join(project, 'draft_content.json'), JSON.stringify(draft));
  await writeFile(join(project, 'draft_meta_info.json'), JSON.stringify(metadata));
  const prepared = await prepareCandidateMedia({ draft, original, project, jobStore });
  assert.equal(prepared.receipt.packaged, 1);
  assert.deepEqual(JSON.parse(await readFile(join(project, 'draft_meta_info.json'), 'utf8')), metadata, 'planning must not write the registry');
  saveDraft(loadDraft(project).filePath, draft, { preserveProjectFields: true, additionalFiles: prepared.additionalFiles });
  assert.deepEqual(draft.materials.videos[0], old);
  const added = draft.materials.videos[1]; assert.ok(added.path.startsWith(project.replaceAll('\\', '/')));
  assert.equal(await readFile(added.path, 'utf8'), 'source video bytes');
  const saved = JSON.parse(await readFile(join(project, 'draft_meta_info.json'), 'utf8'));
  assert.equal(saved.private_field, 123); assert.deepEqual(saved.draft_materials[0].value[0], metadata.draft_materials[0].value[0]);
  assert.equal(saved.draft_materials[0].value.find(m => m.file_Path === added.path).id, added.local_material_id);
  const rebuilt = structuredClone(draft); rebuilt.materials.videos[1].path = source;
  await prepareCandidateMedia({ draft: rebuilt, original, project, jobStore });
  assert.equal(rebuilt.materials.videos[1].path, added.path, 'rebuilding unchanged media must reuse its packaged bytes');
  assert.equal((await prepareCandidateMedia({ draft, original, project, jobStore })).receipt.packaged, 0);
  await writeFile(join(destination, 'draft_meta_info.json'), JSON.stringify(metadata));
  await writeFile(join(destination, 'draft_content.json'), JSON.stringify(draft));
  added.path = join(destination, 'assets', 'raw.mp4').replaceAll('\\', '/');
  const registration = planNewMediaRegistration(draft, destination, original);
  saveDraft(loadDraft(destination).filePath, draft, { preserveProjectFields: true, additionalFiles: registration.additionalFiles });
  const committed = JSON.parse(await readFile(join(destination, 'draft_meta_info.json'), 'utf8'));
  assert.equal(committed.draft_materials[0].value.find(m => m.file_Path === added.path).id, added.local_material_id);
  assert.ok(!JSON.stringify(committed).includes(project));
});

test('stale registry rejects the save without modifying the timeline', async t => {
  const { planNewMediaRegistration } = await import('../src/server/capcut/prepare-media.mjs');
  const { loadDraft, saveDraft } = await import('../toolchain/node_modules/capcut-cli/dist/draft.js');
  const project = await mkdtemp(join(tmpdir(), 'ai-editor-stale-registry-')); t.after(() => rm(project, { recursive: true, force: true }));
  const timeline = join(project, 'draft_content.json'), registry = join(project, 'draft_meta_info.json');
  const original = { platform: { app_source: 'cc', app_version: '9.6.0' }, canvas_config: { width: 1920, height: 1080, ratio: '16:9' }, fps: 30, duration: 1000000, tracks: [], materials: { videos: [] } };
  const bytes = JSON.stringify(original); await writeFile(timeline, bytes); await writeFile(registry, JSON.stringify({ draft_materials: [] }));
  const loaded = loadDraft(project); loaded.draft.materials.videos.push({ id: 'new', type: 'video', path: join(project, 'raw.mp4') });
  const planned = planNewMediaRegistration(loaded.draft, project, original);
  const changed = JSON.stringify({ draft_materials: [], concurrentChange: true }); await writeFile(registry, changed);
  assert.throws(() => saveDraft(loaded.filePath, loaded.draft, { additionalFiles: planned.additionalFiles }), /changed|conflict/i);
  assert.equal(await readFile(timeline, 'utf8'), bytes);
  assert.equal(await readFile(registry, 'utf8'), changed);
});

test('multi-clip commit keeps all new media after both staging candidates are removed', async t => {
  const childProcess = (await import('node:child_process')).default;
  const { syncBuiltinESMExports } = await import('node:module');
  const processCheck = t.mock.method(childProcess, 'execFileSync', command => {
    assert.ok(['tasklist', '/usr/bin/pgrep'].includes(command), 'the fixture must never control the desktop');
    if (command === '/usr/bin/pgrep') throw Object.assign(new Error('No CapCut'), { status: 1 });
    return '';
  });
  syncBuiltinESMExports(); t.after(() => { processCheck.mock.restore(); syncBuiltinESMExports(); });
  const { prepareCandidateMedia } = await import('../src/server/capcut/prepare-media.mjs');
  const { loadDraft, saveDraft } = await import('../toolchain/node_modules/capcut-cli/dist/draft.js');
  const { commitCandidate } = await import('./capcut-draft.mjs');
  const staging = join(process.cwd(), '.local-tools', 'staging'), jobStore = join(process.cwd(), '.local-tools', 'native-assets');
  await mkdir(staging, { recursive: true }); await mkdir(jobStore, { recursive: true });
  const root = await mkdtemp(join(staging, 'media-regression-')), job = await mkdtemp(join(jobStore, 'media-regression-'));
  const destination = await mkdtemp(join(tmpdir(), 'ai-editor-commit-media-'));
  t.after(async () => { await rm(root, { recursive: true, force: true }); await rm(job, { recursive: true, force: true }); await rm(destination, { recursive: true, force: true }); });
  const first = join(root, 'first'), second = join(root, 'second'); await mkdir(first);
  const original = { id: 'original', name: 'Disposable', platform: { app_source: 'cc', app_version: '9.6.0' }, canvas_config: { width: 1920, height: 1080, ratio: '16:9' }, fps: 30, duration: 1000000, materials: { videos: [] }, tracks: [] };
  for (const path of [first, destination]) {
    await writeFile(join(path, 'draft_content.json'), JSON.stringify(original));
    await writeFile(join(path, 'draft_meta_info.json'), JSON.stringify({ draft_materials: [] }));
  }
  for (const [index, project] of [first, second].entries()) {
    if (index) await cp(first, second, { recursive: true });
    const loaded = loadDraft(project), baseline = structuredClone(loaded.draft);
    const path = join(job, `raw-${index}.mp4`); await writeFile(path, `clip-${index}`);
    loaded.draft.materials.videos.push({ id: `new-${index}`, type: 'video', path });
    const prepared = await prepareCandidateMedia({ draft: loaded.draft, original: baseline, project, jobStore });
    saveDraft(loaded.filePath, loaded.draft, { preserveProjectFields: true, additionalFiles: prepared.additionalFiles });
  }
  await commitCandidate(second, destination);
  await rm(root, { recursive: true, force: true }); await rm(job, { recursive: true, force: true });
  const final = loadDraft(destination).draft, meta = JSON.parse(await readFile(join(destination, 'draft_meta_info.json'), 'utf8'));
  for (const [index, material] of final.materials.videos.entries()) {
    assert.ok(material.path.startsWith(destination.replaceAll('\\', '/')), 'no staging or job dependencies survive Apply');
    assert.equal(await readFile(material.path, 'utf8'), `clip-${index}`);
    assert.equal(meta.draft_materials[0].value.find(item => item.id === material.local_material_id).file_Path, material.path);
  }
});

test('packaged video identity accepts exact copies and rejects rendered substitutes', async t => {
  const { matchesSourceBytes } = await import('../src/server/editing/media-identity.mjs');
  const root = await mkdtemp(join(tmpdir(), 'ai-editor-media-identity-')); t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, 'source.mp4'), copy = join(root, 'copy.mp4');
  await writeFile(source, 'original'); await writeFile(copy, 'original');
  assert.equal(await matchesSourceBytes(copy, [source]), true);
  await writeFile(copy, 'modified');
  assert.equal(await matchesSourceBytes(copy, [source]), false);
});

test('media registration commits atomically when the metadata also contains the timeline', async t => {
  const { prepareCandidateMedia } = await import('../src/server/capcut/prepare-media.mjs');
  const { loadDraft, saveDraft } = await import('../toolchain/node_modules/capcut-cli/dist/draft.js');
  const root = await mkdtemp(join(tmpdir(), 'ai-editor-embedded-metadata-')); t.after(() => rm(root, { recursive: true, force: true }));
  const project = join(root, 'candidate'), jobStore = join(root, 'jobs'); await mkdir(project); await mkdir(jobStore);
  const media = join(jobStore, 'raw.mp4'); await writeFile(media, 'source');
  const original = { platform: { app_source: 'cc', app_version: '9.6.0' }, canvas_config: { width: 1920, height: 1080, ratio: '16:9' }, fps: 30, duration: 1000000, tracks: [], materials: { videos: [] }, draft_materials: [] };
  const path = join(project, 'draft_meta_info.json'); await writeFile(path, JSON.stringify(original));
  const loaded = loadDraft(project), draft = loaded.draft;
  draft.materials.videos.push({ id: 'new', type: 'video', path: media });
  const prepared = await prepareCandidateMedia({ draft, original, project, jobStore });
  saveDraft(loaded.filePath, draft, { preserveProjectFields: true, additionalFiles: prepared.additionalFiles });
  const written = loadDraft(project).draft;
  assert.ok(written.materials.videos[0].local_material_id);
  const meta = JSON.parse(await readFile(path, 'utf8'));
  assert.equal(meta.draft_materials[0].value[0].id, written.materials.videos[0].local_material_id);
});
