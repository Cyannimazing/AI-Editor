import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks, syncBuiltinESMExports } from 'node:module';
import fs, { existsSync, statSync } from 'node:fs';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const root = await mkdtemp(join(tmpdir(), 'ai-editor-discovery-'));
after(() => rm(root, { recursive: true, force: true }));
const previous = process.env.AI_EDITOR_DRAFTS_ROOT;
process.env.AI_EDITOR_DRAFTS_ROOT = root;
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
const helper = await import('../src/lib/keyframe-helper.ts');
hook.deregister();
if (previous === undefined) delete process.env.AI_EDITOR_DRAFTS_ROOT; else process.env.AI_EDITOR_DRAFTS_ROOT = previous;

function draft(version = '9.6.0') {
  return { id: 'private-project', name: 'Private title', fps: 30, duration: 1000000,
    platform: { app_version: version, app_source: 'cc', device_id: 'private-device' },
    materials: { videos: [{ id: 'v', path: 'missing.mp4' }], texts: [{ id: 't', content: 'PRIVATE CAPTION' }] },
    tracks: [{ type: 'video', segments: [{ id: 's', material_id: 'v', target_timerange: { start: 0, duration: 1000000 },
      common_keyframes: [{ property_type: 'KFTypeScaleX', keyframe_list: [
        { time_offset: 0, values: [1], curveType: 'Line' }, { time_offset: 1000000, values: [1.3], curveType: 'Line' },
      ] }] }] }] };
}
async function project(t, name, data = draft()) {
  const folder = join(root, name); await mkdir(folder);
  t.after(() => rm(folder, { recursive: true, force: true }));
  await writeFile(join(folder, 'draft_content.json'), JSON.stringify(data));
  return folder;
}

test('discovery counts hidden review copies, can reveal them, and does not hide user-named Verify projects', async t => {
  await project(t, 'Trial'); await project(t, 'Verify user project');
  const review = await project(t, 'Verify temporary');
  await writeFile(join(review, '.ai-editor-review.json'), JSON.stringify({ kind: 'temporary-review' }));
  const filtered = await helper.discoverProjects(false);
  assert.equal(filtered.discovery.hiddenReviewCopies, 1);
  assert.equal(filtered.discovery.capcutProjectsFound, 3);
  assert.deepEqual(filtered.projects.map(p => p.id).sort(), ['Trial', 'Verify user project']);
  const shown = await helper.discoverProjects(true);
  assert.equal(shown.projects.find(p => p.id === 'Verify temporary').kind, 'temporary-review');
  assert.equal(shown.discovery.hiddenReviewCopies, 0);
});

test('discovery reports unreadable timelines rather than saying no projects exist', async t => {
  const broken = await project(t, 'Broken'); await writeFile(join(broken, 'draft_content.json'), 'not JSON');
  const cache = join(root, '.recycle_bin'); await mkdir(cache); t.after(() => rm(cache, { recursive: true, force: true }));
  const result = await helper.discoverProjects(false);
  assert.equal(result.discovery.capcutProjectsFound, 1);
  assert.equal(result.discovery.unreadableProjects.length, 1);
  assert.equal(result.discovery.unreadableProjects[0].name, 'Broken');
  assert.equal(result.projects.length, 0);
});

test('read-only compatibility report works for 18.2, shows missing media and native zoom without leaking private data', async t => {
  const folder = await project(t, 'Mac report', draft('18.2.0'));
  const before = await readFile(join(folder, 'draft_content.json'));
  const report = await helper.projectCompatibilityReport('Mac report');
  assert.equal(report.compatibility.writeAllowed, false);
  assert.equal(report.compatibility.appVersion, '18.2.0');
  assert.equal(report.media[0].access, 'missing');
  assert.deepEqual(report.timeline.segments[0].curves[0].points.map(p => p.values), [[1], [1.3]]);
  for (const secret of [root, 'Private title', 'private-project', 'private-device', 'PRIVATE CAPTION', 'missing.mp4']) {
    assert.ok(!JSON.stringify(report).includes(secret), secret);
  }
  assert.deepEqual(await readFile(join(folder, 'draft_content.json')), before);
  await assert.rejects(helper.projectCompatibilityReport('../outside'), /Invalid project name/);
});

test('a compatibility report separates accessible app media from CapCut playback and preserves cancellation', async t => {
  const folder = await project(t, 'Accessible'); await writeFile(join(folder, 'missing.mp4'), 'disposable media');
  const report = await helper.projectCompatibilityReport('Accessible');
  assert.equal(report.media[0].access, 'readable');
  assert.equal(report.compatibility.nativePlaybackChecked, false);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(helper.discoverProjects(false, controller.signal), { name: 'AbortError' });
  await assert.rejects(helper.projectCompatibilityReport('Accessible', controller.signal), { name: 'AbortError' });
});

test('large motion reports have a global evidence limit and flag omitted data', async t => {
  const data = draft();
  const segment = data.tracks[0].segments[0];
  segment.common_keyframes[0].keyframe_list = Array.from({ length: 256 }, (_, i) => ({ time_offset: i, values: [1] }));
  data.tracks[0].segments = Array.from({ length: 100 }, () => structuredClone(segment));
  await project(t, 'Large curves', data);
  const report = await helper.projectCompatibilityReport('Large curves');
  const points = report.timeline.segments.flatMap(s => s.curves).flatMap(c => c.points);
  assert.ok(points.length <= 4096);
  assert.equal(report.timeline.truncated, true);
});

test('malformed project records produce a sanitized report instead of leaking a subprocess error', async t => {
  const data = draft(); data.materials.videos = [null];
  await project(t, 'Malformed', data);
  const report = await helper.projectCompatibilityReport('Malformed');
  assert.equal(report.failure.code, 'PROJECT_STRUCTURE_INVALID');
  assert.equal(report.compatibility.writeAllowed, false);
  assert.ok(!JSON.stringify(report).includes(root));
});

test('an inaccessible child folder is reported instead of being treated as no project', async t => {
  const folder = await project(t, 'Unreadable folder');
  const original = fs.promises.readdir;
  fs.promises.readdir = async (path, ...args) => {
    if (String(path) === folder) throw Object.assign(new Error('Private OS detail'), { code: 'EACCES' });
    return original(path, ...args);
  };
  syncBuiltinESMExports();
  try {
    const result = await helper.discoverProjects(false);
    assert.equal(result.projects.length, 0);
    assert.equal(result.discovery.unreadableProjects[0].name, 'Unreadable folder');
    assert.ok(!JSON.stringify(result).includes('Private OS detail'));
  } finally { fs.promises.readdir = original; syncBuiltinESMExports(); }
});
