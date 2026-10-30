import test from 'node:test';
import assert from 'node:assert/strict';
import { combineReviews, qualityAction, candidateStatusNotes } from '../src/server/editing/quality.mjs';
import { intervalDigest, snapshotPreviewInputs, sealPreviewEvidence, assertPreviewEvidence, carryForwardPreviewEvidence } from '../src/server/editing/preview-evidence.mjs';
import { assertCapCutClosed } from '../src/server/capcut/desktop-policy.mjs';
import { previewCoverageIssues } from '../src/server/editing/preview-coverage.mjs';
import { assertProjectWriteVersion } from '../src/server/capcut/project-version.mjs';
import { directoryDigest, transactionalWrite } from '../src/server/editing/transaction.ts';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { registerHooks } from 'node:module';
import { existsSync, statSync } from 'node:fs';
import { captureFailureDiagnostic, buildJobDiagnosticReport } from '../src/server/editing/diagnostics.mjs';
import { packageJobResources } from '../src/server/capcut/package-resources.mjs';

const technique = { id: 'zoom', name: 'Continuous zoom', start: 0, expectedBehavior: '100% to 130% over the full clip' };
const assessment = { decision: 'ready', summary: 'Zoom matches the requested movement.', defects: [], unknowns: [],
  techniques: [{ id: 'zoom', status: 'matched', evidence: 'Serialized endpoints and timed preview frames match.' }] };

test('explicit preview review can pass without claiming native verification', () => {
  const report = combineReviews([assessment, assessment], [technique], false, 'revision', [], 'preview');
  assert.equal(report.decision, 'ready');
  assert.equal(report.reviewMode, 'preview');
  assert.equal(report.nativeVerified, false);
  assert.equal(qualityAction(report, 1, 4), 'approve');
  assert.match(candidateStatusNotes({ verified: true, previewReady: true, quality: report }), /preview checks passed/i);
  assert.doesNotMatch(candidateStatusNotes({ verified: true, previewReady: true, quality: report }), /Candidate verified|Native verification passed/);
});

test('preview mode still rejects missing reviews, unsupported requirements and unresolved techniques', () => {
  for (const [reports, requirements] of [[[assessment], []], [[assessment, assessment], ['Missing effect bundle']],
    [[assessment, { ...assessment, techniques: [{ id: 'zoom', status: 'unverified', evidence: 'Renderer omitted movement.' }] }], []]]) {
    const report = combineReviews(reports, [technique], false, 'revision', requirements, 'preview');
    assert.equal(report.decision, 'blocked');
    assert.notEqual(qualityAction(report, 1, 4), 'approve');
  }
  assert.equal(combineReviews([assessment, assessment], [technique], false, 'revision').decision, 'blocked', 'Legacy native mode must still require its native evidence');
});

function draft() {
  return { id: 'candidate', name: 'Candidate', fps: 30, canvas_config: { width: 640, height: 360 }, color_space: 0,
    materials: { videos: [], texts: [], transitions: [{ id: 'transition', type: 'crossfade', duration: 600000, is_overlap: true }] },
    tracks: [{ id: 'video', type: 'video', segments: [
      { id: 'one', material_id: 'v1', target_timerange: { start: 0, duration: 1000000 }, clip: { alpha: 1 } },
      { id: 'two', material_id: 'v2', target_timerange: { start: 1000000, duration: 1000000 }, clip: { alpha: 1 } },
    ] }] };
}

test('carry-forward fingerprints bind project rendering settings and transition neighbours', () => {
  const before = draft(), interval = { start: 0, duration: 1 };
  for (const field of ['color_space', 'render_index_track_mode_on']) {
    const after = structuredClone(before); after[field] = 1;
    assert.notEqual(intervalDigest(before, interval), intervalDigest(after, interval), field);
  }
  before.tracks[0].segments[0].extra_material_refs = ['transition'];
  const after = structuredClone(before); after.tracks[0].segments[1].clip.alpha = 0;
  assert.notEqual(intervalDigest(before, interval), intervalDigest(after, interval));
});

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'ai-editor-preview-evidence-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const job = join(root, 'job'), candidate = join(root, 'candidate');
  await mkdir(job); await mkdir(candidate);
  const resource = join(root, 'effect'); await mkdir(resource); await writeFile(join(resource, 'effect.json'), 'effect bytes');
  const media = join(root, 'source.mp4'), font = join(root, 'font.ttf');
  await writeFile(media, 'source bytes'); await writeFile(font, 'font bytes');
  const document = draft();
  document.materials.video_effects = [{ id: 'fx', path: resource }];
  document.materials.videos = [{ id: 'v1', path: media }, { id: 'v2', path: media }];
  document.materials.texts = [{ id: 'text', content: JSON.stringify({ styles: [{ font: { path: font } }] }) }];
  await writeFile(join(candidate, 'draft_content.json'), JSON.stringify(document));
  const revision = await directoryDigest(candidate);
  const quality = combineReviews([assessment, assessment], [technique], false, revision, [], 'preview');
  const files = { 'preview.mp4': 'preview', 'preview-1.mp4': 'preview', 'preview-plan-1.json': '{}', 'controlled-editing-plan.json': '{}',
    'manifest.json': '{}', 'quality-report.json': JSON.stringify(quality), 'structural-evidence-1.json': JSON.stringify({ candidateDigest: revision,
      structuralValidation: 'passed', lint: { ok: true }, originalUnchanged: true, unrelatedContentPreserved: true }),
    'lint-1.json': '{"ok":true}', 'motion-curves-1.json': '{}', 'preview-coverage-1.json': JSON.stringify({candidateDigest: revision, issues: []}), 'assessment-1/reviewer.json': JSON.stringify(assessment),
    'assessment-1/manager.json': JSON.stringify(assessment), 'preview-evidence-1/reference-frames.json': '{}' };
  for (const [name, bytes] of Object.entries(files)) { const path = join(job, name); await mkdir(dirname(path), { recursive: true }); await writeFile(path, bytes); }
  const inputs = await snapshotPreviewInputs(candidate);
  const evidence = await sealPreviewEvidence({ inputs, job, candidate, iteration: 1, quality, interval: { start: 0, duration: 1 } });
  return { root, job, candidate, document, quality, inputs, evidence, media, font, resource };
}

test('preview approval rejects changed media, fonts, preview files, reports and truncated receipts', async t => {
  const f = await fixture(t);
  assert.equal((await assertPreviewEvidence(f.job, f.candidate, f.evidence)).nativeVerified, false);
  for (const file of [f.media, f.font, join(f.resource, 'effect.json'), join(f.job, 'preview.mp4'), join(f.job, 'assessment-1/manager.json')]) {
    const old = await readFile(file); await writeFile(file, 'changed');
    await assert.rejects(assertPreviewEvidence(f.job, f.candidate, f.evidence), /changed/);
    await writeFile(file, old);
  }
  const receipt = JSON.parse(await readFile(f.evidence, 'utf8')); receipt.files = receipt.files.slice(0, 1);
  await writeFile(f.evidence, JSON.stringify(receipt));
  await assert.rejects(assertPreviewEvidence(f.job, f.candidate, f.evidence), /incomplete/);
});

test('multi-clip approval rebinds unchanged intervals but rejects overlapping control changes', async t => {
  const f = await fixture(t), next = join(f.root, 'next'); await cp(f.candidate, next, { recursive: true });
  const modified = structuredClone(f.document); modified.id = 'new-isolated-id'; modified.name = 'Other candidate'; modified.tracks[0].segments[1].clip.alpha = 0.5;
  await writeFile(join(next, 'draft_content.json'), JSON.stringify(modified));
  const carried = await carryForwardPreviewEvidence(f.job, f.candidate, next, f.evidence);
  assert.equal((await assertPreviewEvidence(f.job, next, carried.evidencePath)).candidateDigest, await directoryDigest(next));
  modified.tracks[0].segments[0].clip.alpha = 0.2; await writeFile(join(next, 'draft_content.json'), JSON.stringify(modified));
  await assert.rejects(carryForwardPreviewEvidence(f.job, f.candidate, next, f.evidence), /overlapping component/);
});

test('apply guard only queries processes, keeps running-app errors retryable and fails closed on status errors', async () => {
  for (const platform of ['win32', 'darwin']) {
    const calls = [];
    const run = async (...args) => { calls.push(args); return { stdout: platform === 'darwin' ? '123\n' : '"CapCut.exe","123"' }; };
    await assert.rejects(assertCapCutClosed({ platform, run }), error => error.code === 'CAPCUT_RUNNING');
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], platform === 'darwin' ? '/usr/bin/pgrep' : 'tasklist.exe');
    await assertCapCutClosed({ platform, run: async () => platform === 'darwin' ? Promise.reject({ code: 1 }) : { stdout: 'INFO: No tasks are running.' } });
    await assert.rejects(assertCapCutClosed({ platform, run: async () => { throw new Error('status unavailable'); } }), /status unavailable/);
  }
});


test('an aborted precommit check preserves concurrent saves and the retryable error', async t => {
  const f = await fixture(t), original = join(f.root, 'original'); await mkdir(original);
  const file = join(original, 'draft_content.json'); await writeFile(file, 'saved-before');
  const expectedDigest = await directoryDigest(original); let wrote = false;
  await assert.rejects(transactionalWrite({ project: original, expectedDigest, journalRoot: join(f.root, 'journal'),
    beforeWrite: async () => { await writeFile(file, 'concurrent-save'); throw Object.assign(new Error('Close CapCut manually.'), { code: 'CAPCUT_RUNNING' }); },
    write: async () => { wrote = true; await writeFile(file, 'candidate'); }, validate: async () => {},
  }), error => error.code === 'CAPCUT_RUNNING');
  assert.equal(wrote, false); assert.equal(await readFile(file, 'utf8'), 'concurrent-save');
});


test('changes during rendering or model review cannot be blessed by sealing', async t => {
  const f = await fixture(t); await writeFile(f.media, 'changed while reviewing');
  await assert.rejects(sealPreviewEvidence({ inputs: f.inputs, job: f.job, candidate: f.candidate, iteration: 1,
    quality: f.quality, interval: { start: 0, duration: 1 } }), /changed/);
});

test('preview coverage rejects hidden overlapping layers, optical effects and static keyframe fallback', () => {
  const d = draft(); d.materials.transitions = [];
  const interval = { start: 0, duration: 1 }, refs = { source: 'one' };
  const preview = { previewKind: 'native-curves-local-preview', fidelity: { dropped: {} } };
  d.tracks[0].segments[0].common_keyframes = [{ property_type: 'KFTypeScaleX', keyframe_list: [{ values: [1], time_offset: 0 }, { values: [1.3], time_offset: 1000000 }] }];
  assert.deepEqual(previewCoverageIssues(d, refs, interval, preview), []);
  assert.match(previewCoverageIssues(d, refs, interval, {previewKind:'approximate'}).join(' '), /keyframes/);
  d.tracks.push({ type: 'text', segments: [{ id: 'existing-title', material_id: 'text', target_timerange: {start: 0, duration: 500000} }] });
  assert.match(previewCoverageIssues(d, refs, interval, preview).join(' '), /omits overlapping text/);
  d.tracks.pop(); d.materials.video_effects = [{ id: 'fx' }]; d.tracks[0].segments[0].extra_material_refs = ['fx'];
  assert.match(previewCoverageIssues(d, refs, interval, preview).join(' '), /effects/);
});

test('version preflight is read-only and preserves the upstream ceiling for Mac 18.2 and newer writers', async t => {
  const f = await fixture(t);
  for (const markers of [{ platform: { app_source: 'cc', app_version: '18.2.0', os: 'mac' } },
    { platform: { app_source: 'cc', app_version: '8.7.0' }, last_modified_platform: { app_version: '18.2.0' } },
    { platform: { app_source: 'cc', app_version: '8.7.0' }, version: 999999 }]) {
    await writeFile(join(f.candidate, 'draft_content.json'), JSON.stringify({ ...f.document, ...markers }));
    const before = await directoryDigest(f.candidate);
    assert.throws(() => assertProjectWriteVersion(f.candidate), error => error.code === 'CAPCUT_VERSION_UNSUPPORTED');
    assert.equal(await directoryDigest(f.candidate), before);
  }
  await writeFile(join(f.candidate, 'draft_content.json'), JSON.stringify({ ...f.document, platform: { app_source: 'cc', app_version: '8.7.0' } }));
  assert.notEqual(assertProjectWriteVersion(f.candidate).action, 'refuse');
});


test('review controller runs two preview assessments without demanding desktop evidence', async t => {
  const f = await fixture(t), calls = [];
  await writeFile(join(f.job, 'controlled-editing-plan.json'), JSON.stringify({ techniques: [technique], unsupported: [] }));
  await writeFile(join(f.job, 'manifest.json'), '{}');
  await writeFile(join(f.job, 'execution-1.json'), '{}');
  globalThis.previewReviewTestWorker = async (_exe, args, _job, prompt, _log, _timeout, _signal, role) => {
    calls.push(role); assert.match(prompt, /NOT REQUESTED/);
    assert.doesNotMatch(prompt, /If native evidence is missing, decision must be blocked/);
    await writeFile(args[args.indexOf('--output-last-message') + 1], JSON.stringify(assessment));
  };
  const stub = 'data:text/javascript,' + encodeURIComponent('export const codexExecutable=async()=>"mock"; export const runCodexStream=(...args)=>globalThis.previewReviewTestWorker(...args);');
  const hook = registerHooks({ resolve(specifier, context, next) {
    if (specifier.endsWith('/lib/reference-analysis')) return { url: stub, shortCircuit: true };
    if (specifier.startsWith('.') && context.parentURL) {
      const url = new URL(specifier, context.parentURL);
      if (!existsSync(url)) for (const suffix of ['.ts', '.mjs']) {
        const candidate = new URL(url.href + suffix);
        if (existsSync(candidate) && statSync(candidate).isFile()) return next(candidate.href, context);
      }
    }
    return next(specifier, context);
  } });
  try {
    const { reviewAndManage } = await import('../src/server/editing/review.ts');
    const before = await directoryDigest(f.candidate);
    const reviewed = await reviewAndManage({ job:f.job, candidate:f.candidate, request:'Zoom 100% to 130%',
      referenceFrames:[], previewFrames:[], referenceEvidence:'Instruction only', previewEvidence:'Fixture',
      nativeVerified:false, reviewMode:'preview', iteration:1, onLog(){} });
    assert.deepEqual(calls, ['reviewer', 'manager']);
    assert.equal(reviewed.decision, 'ready'); assert.equal(reviewed.nativeVerified, false);
    assert.equal(await directoryDigest(f.candidate), before);
  } finally { hook.deregister(); delete globalThis.previewReviewTestWorker; }
});

test('Apply packaging retains generated raw media even after its working directory is gone', async t => {
  const f = await fixture(t), store = join(f.root, 'store'), destination = join(f.root, 'saved-project');
  await mkdir(store); await mkdir(destination);
  const source = join(store, 'raw.mp4'); await writeFile(source, 'disposable media bytes');
  const document = { materials: { videos: [{ id:'raw', path:source }] } };
  assert.equal(await packageJobResources(document, destination, store), 1);
  const copied = document.materials.videos[0].path;
  assert.notEqual(copied, source); await rm(store, { recursive:true });
  assert.equal(await readFile(copied,'utf8'), 'disposable media bytes');
});


test('an incoming transition from the previous clip remains a preview limitation', () => {
  const d = draft(); d.tracks[0].segments[0].extra_material_refs = ['transition'];
  const issues = previewCoverageIssues(d, {source:'two'}, {start:1,duration:1}, {previewKind:'native-curves-local-preview'});
  assert.match(issues.join(' '), /transitions/);
});


test('shareable compatibility diagnostics preserve version facts without private paths or override instructions', () => {
  const diagnostic = captureFailureDiagnostic(Object.assign(new Error('private path and --force-write'), {
    code:'CAPCUT_VERSION_UNSUPPORTED', compatibility:{appVersion:'18.2.0',schema:360000,privatePath:'/private/user'},
  }));
  const report = buildJobDiagnosticReport({id:'fixture',status:'failed',diagnostic});
  assert.equal(report.failure.code, 'CAPCUT_VERSION_UNSUPPORTED');
  assert.deepEqual(report.failure.details, {appVersion:'18.2.0',schema:360000});
  assert.doesNotMatch(JSON.stringify(report), /private path|privatePath|force-write|\/private\/user/);
});
