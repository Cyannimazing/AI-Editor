import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { existsSync, statSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, basename } from 'node:path';

// Match the app's extensionless TypeScript imports in Node's test runtime.
const hook = registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith('.') && context.parentURL) {
    const url = new URL(specifier, context.parentURL);
    if (!existsSync(url)) for (const suffix of ['.ts', '.mjs']) {
      const candidate = new URL(url.href + suffix);
      if (existsSync(candidate) && statSync(candidate).isFile()) return next(candidate.href, context);
    }
  }
  return next(specifier, context);
} });
const { readProjectDraft, resolveTimelineClip } = await import('../src/lib/keyframe-helper.ts');
hook.deregister();
const { activeDraft } = await import('./capcut-draft.mjs');

function draft(duration) {
  return { id: 'project', fps: 30, duration, platform: { app_version: '8.7.0', os: 'mac' },
    materials: { videos: [{ id: 'media', path: 'source.mp4', duration: 10471667 }] },
    tracks: [{ id: 'track', type: 'video', segments: [{ id: 'clip', material_id: 'media', speed: 1,
      target_timerange: { start: 0, duration }, source_timerange: { start: 0, duration } }] }] };
}
async function project(t) {
  const root = join(process.cwd(), '.local-tools/projects'); await mkdir(root, { recursive: true });
  const folder = await mkdtemp(join(root, 'test-project-reader-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  return { folder, id: `local:${basename(folder)}` };
}

test('project selection reads the same canonical modern document as native CLI edits', async t => {
  const { folder, id } = await project(t);
  await writeFile(join(folder, 'draft_content.json'), JSON.stringify(draft(15866666)));
  await writeFile(join(folder, 'template-2.tmp'), JSON.stringify(draft(10471667)));
  const before = await readFile(join(folder, 'draft_content.json'));
  const loaded = await readProjectDraft(id);
  assert.equal(loaded.draft.tracks[0].segments[0].target_timerange.duration, 10471667);
  assert.equal(basename(loaded.path), 'template-2.tmp');
  assert.deepEqual(await readFile(join(folder, 'draft_content.json')), before);
});

test('disagreeing active documents cannot supply an arbitrary selected clip duration', async t => {
  const { folder, id } = await project(t), active = join(folder, 'Timelines', 'active');
  await mkdir(active, { recursive: true });
  await writeFile(join(folder, 'draft_content.json'), JSON.stringify(draft(15866666)));
  await writeFile(join(folder, 'Timelines/project.json'), JSON.stringify({ main_timeline_id: 'active', timelines: [{ id: 'active' }] }));
  await writeFile(join(active, 'draft_content.json'), JSON.stringify(draft(15866666)));
  await writeFile(join(active, 'draft_info.json'), JSON.stringify(draft(10471667)));
  await assert.rejects(readProjectDraft(id), /documents disagree/i);
});

test('selected clip resolution rejects duplicate material IDs instead of taking the first file', async t => {
  const { folder, id } = await project(t), data = draft(10471667);
  data.materials.videos.push({ ...data.materials.videos[0], path: 'different.mp4' });
  await writeFile(join(folder, 'draft_content.json'), JSON.stringify(data));
  await writeFile(join(folder, 'source.mp4'), 'fixture');
  await assert.rejects(resolveTimelineClip(id, 'clip'), /ambiguous|duplicate/i);
});

test('a selected clip keeps its own ten-second range in a longer nested project', async t => {
  const { folder, id } = await project(t), active = join(folder, 'Timelines', 'active');
  await mkdir(active, { recursive: true });
  await writeFile(join(folder, 'draft_content.json'), JSON.stringify(draft(15866666)));
  const current = draft(10471667); current.duration = 15866666;
  await writeFile(join(folder, 'Timelines/project.json'), JSON.stringify({ main_timeline_id: 'active', timelines: [{ id: 'active' }] }));
  await writeFile(join(active, 'draft_info.json'), JSON.stringify(current));
  await writeFile(join(folder, 'source.mp4'), 'fixture');
  const loaded = await resolveTimelineClip(id, 'clip');
  assert.equal(loaded.segment.target_timerange.duration, 10471667);
  assert.equal(loaded.draft.duration, 15866666);
  assert.equal(loaded.mapping.document, 'draft_info.json'); assert.equal(loaded.mapping.scope, 'active');
  assert.match(loaded.mapping.sourcePathHash, /^[0-9a-f]{64}$/);
  assert.ok(!JSON.stringify(loaded.mapping).includes(folder));
});

test('project reads and selection preserve cancellation before launching a reader', async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(readProjectDraft('local:does-not-exist', controller.signal), { name: 'AbortError' });
  await assert.rejects(resolveTimelineClip('local:does-not-exist', 'clip', controller.signal), { name: 'AbortError' });
});

test('a CLI snapshot retains the exact canonical raw text bound to its parsed timing', async t => {
  const { folder } = await project(t);
  const before = JSON.stringify(draft(10471667));
  await writeFile(join(folder, 'draft_content.json'), before);
  const snapshot = await activeDraft(folder, true);
  await writeFile(join(folder, 'draft_content.json'), JSON.stringify(draft(15866666)));
  assert.equal(snapshot.raw, before);
  assert.equal(snapshot.draft.tracks[0].segments[0].target_timerange.duration, 10471667);
});

test('multiple referenced speed materials cannot choose an arbitrary playback interpretation', async t => {
  const { folder, id } = await project(t);
  for (const speeds of [ [{ id: 'slow', speed: 0.5 }, { id: 'normal', speed: 1 }],
    [{ id: 'slow', speed: 0.5 }, { id: 'slow', speed: 1 }] ]) {
    const data = draft(10471667);
    data.materials.speeds = speeds;
    data.tracks[0].segments[0].extra_material_refs = ['slow', 'normal'];
    await writeFile(join(folder, 'draft_content.json'), JSON.stringify(data));
    await writeFile(join(folder, 'source.mp4'), 'fixture');
    await assert.rejects(resolveTimelineClip(id, 'clip'), /speed.*ambiguous|ambiguous.*speed/i);
  }
});
