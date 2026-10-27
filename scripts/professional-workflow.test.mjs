import test from 'node:test';
import { recoverStructuredReport } from '../src/server/editing/report-recovery.mjs';
import assert from 'node:assert/strict';

test('malformed specialist reports repair within the role, while execution failures do not retry', async () => {
  let calls = 0, notices = 0;
  const result = await recoverStructuredReport({ generate: async correction => { calls++; if (calls === 1) return '{"summary":"broken"}'; assert.match(correction, /findings/); return '{"summary":"fixed","findings":[]}'; },
    validate: value => { if (!Array.isArray(value.findings)) throw new Error('Missing findings'); return value; }, onRetry: () => notices++ });
  assert.equal(result.summary, 'fixed'); assert.equal(calls, 2); assert.equal(notices, 1);
  calls = 0;
  await assert.rejects(recoverStructuredReport({ generate: async () => { calls++; throw new Error('Authentication failed'); }, validate: value => value, onRetry: () => notices++ }), /Authentication failed/);
  assert.equal(calls, 1); assert.equal(notices, 1);
  await assert.rejects(recoverStructuredReport({ generate: async () => 'invalid', validate: value => value, onRetry: () => {} }), /after one repair/);
});
import { addKeyframes } from '../toolchain/node_modules/capcut-cli/dist/decorators.js';
import { addEffect } from '../toolchain/node_modules/capcut-cli/dist/factory.js';
import { findEnum } from '../toolchain/node_modules/capcut-cli/dist/enums.js';
import { writeMotionCurves, writeCatalogEffect, enableNativeCompositing } from '../src/server/editing/native-controls.mjs';
import { assertTechniqueContinuity, retainTechniqueContract, combineReviews, qualityAction } from '../src/server/editing/quality.mjs';
import { nativeCurveValue, motionComposition } from '../src/server/editing/motion-preview.mjs';
import { specialistAssignments, specialistCacheKey, validateSpecialistReport } from '../src/server/editing/scheduling.mjs';
import { validateControlledPlan } from '../src/server/editing/controlled-plan.mjs';
import { availableTextFonts, resolveTextFont } from '../src/server/editing/text-fonts.mjs';

const technique = { id: 'entrance', name: 'Measured entrance', start: 0, end: 1, expectedBehavior: 'Move left to centre with a held flash.', checks: ['Check start, motion peak and settled position.'] };
const report = overrides => ({ decision: 'ready', summary: 'Review', defects: [], unknowns: [], techniques: [{ id: technique.id, status: 'matched', evidence: 'Timed comparison' }], ...overrides });
test('review manager cannot erase defects and last-round defects cannot pass', () => {
  const defect = { component: 'entrance', timeSeconds: 0.2, expected: 'Visible entrance', observed: 'Static layer', evidence: 'Comparison frames 0 and 6' };
  const combined = combineReviews([report({ decision: 'revise', defects: [defect] }), report()], [technique], true, 'revision');
  assert.deepEqual(combined.defects, [defect]);
  assert.equal(qualityAction(combined, 1, 4), 'repair');
  assert.equal(qualityAction(combined, 4, 4), 'exhausted');
});
test('missing comparisons, missing native evidence and unresolved decisions never pass', () => {
  for (const reports of [[], [report({ techniques: [] })], [report({ decision: 'blocked' })], [report({ unknowns: ['Motion not observed'] })]]) {
    assert.equal(qualityAction(combineReviews(reports, [technique], true, 'revision'), 1, 4), 'needs-evidence');
  }
  assert.equal(qualityAction(combineReviews([report()], [technique], false, 'revision'), 1, 4), 'needs-evidence');
  assert.equal(qualityAction(combineReviews([report()], [technique], true, 'revision'), 1, 4), 'needs-evidence');
  assert.equal(qualityAction(combineReviews([report(), report()], [technique], true, 'revision'), 1, 4), 'approve');
  assert.equal(qualityAction(combineReviews([report(), report()], [technique], true, 'revision', ['Required sound remains unresolved.']), 1, 4), 'needs-evidence');
  assert.throws(() => combineReviews([report({ techniques: [{ id: 'invented', status: 'matched', evidence: 'claim' }] })], [technique], true, 'revision'), /Invalid/);
});
test('corrections retain techniques and cannot weaken acceptance', () => {
  assert.doesNotThrow(() => assertTechniqueContinuity([technique], { techniques: [technique] }));
  assert.throws(() => assertTechniqueContinuity([technique], { techniques: [] }), /removed/);
  assert.throws(() => assertTechniqueContinuity([technique], { techniques: [{ ...technique, checks: ['Exists in JSON'] }] }), /weakened/);
  const restored = retainTechniqueContract([technique], { techniques: [{ ...technique, name: 'Rephrased', checks: ['Exists in JSON'], components: ['overlay-1'] }] });
  assertTechniqueContinuity([technique], restored);
  assert.deepEqual(restored.techniques[0].components, ['overlay-1']);
  assert.throws(() => retainTechniqueContract([technique], { techniques: [] }), /removed/);
});

test('missing cached resources stay unverified without spending a visual correction round', () => {
  const result = combineReviews([report(), report()], [technique], true, 'revision', ['Native effect bundle is absent from the local cache.']);
  assert.equal(result.decision, 'blocked');
  assert.equal(qualityAction(result, 1, 4), 'needs-evidence');
  assert.ok(result.unknowns.some(item => item.includes('bundle is absent')));
});

test('native compositing enables opacity without erasing other material flags', () => {
  const draft = { tracks: [{ segments: [{ id: 'clip', material_id: 'asset' }] }], materials: { videos: [{ id: 'asset', check_flag: 39 }] } };
  const receipt = enableNativeCompositing(draft, 'clip');
  assert.equal(receipt.after, 47);
  assert.equal(enableNativeCompositing(draft, 'clip').after, 47);
  assert.throws(() => enableNativeCompositing(draft, 'missing'), /Missing/);
});
test('complete native curves preserve holds and neighbouring eased handles', () => {
  const segment = { id: 'segment', common_keyframes: [] };
  const draft = { fps: 30, tracks: [{ id: 'track', segments: [segment] }] };
  const operations = [
    { op: 'keyframe', target: 'source', property: 'alpha', time: 0, value: 0, easing: 'hold' },
    { op: 'keyframe', target: 'source', property: 'alpha', time: 1, value: 1, easing: 'linear' },
    { op: 'keyframe', target: 'source', property: 'position_x', time: 0, value: -0.5, easing: 'linear' },
    { op: 'keyframe', target: 'source', property: 'position_x', time: 1, value: 0, easing: 'ease-out' },
  ];
  const [receipt] = writeMotionCurves(draft, operations, { source: 'segment' }, addKeyframes);
  assert.equal(receipt.holdKeyframes, 1);
  assert.equal(receipt.warnings.length, 0);
  const alpha = segment.common_keyframes.find(curve => curve.property_type === 'KFTypeAlpha');
  assert.deepEqual(alpha.keyframe_list.map(frame => [frame.time_offset, frame.values[0]]), [[0, 0], [966667, 0], [1000000, 1]]);
  const position = segment.common_keyframes.find(curve => curve.property_type === 'KFTypePositionX');
  assert.equal(position.keyframe_list[0].curveType, 'FreeCurveInOut');
  assert.ok(position.keyframe_list[0].right_control.x > 0);
  assert.equal(nativeCurveValue(alpha.keyframe_list, 500000, 1), 0);
  assert.equal(nativeCurveValue(alpha.keyframe_list, 1100000, 0), 1);
  assert.ok(nativeCurveValue(position.keyframe_list, 500000, -0.5) > -0.12);
});

test('motion preview escapes untrusted text instead of executing it as HTML', () => {
  const html = motionComposition([{ kind: 'text', start: 0, fontSize: 36, color: '#FFFFFF', text: '</div><script>bad()</script>',
    segment: { target_timerange: { duration: 1000000 }, clip: {} } }], { width: 640, height: 360, duration: 1, fps: 30 });
  assert.ok(!html.includes('<script>bad()'));
  assert.ok(html.includes('&lt;script&gt;bad()'));
});

test('terminal hold uses the native last-value hold without a fabricated neighbour', () => {
  const segment = { id: 'segment', common_keyframes: [] };
  const draft = { fps: 30, tracks: [{ segments: [segment] }] };
  const receipts = writeMotionCurves(draft, [{ op: 'keyframe', target: 'source', property: 'alpha', time: 1, value: 0, easing: 'hold' }], { source: 'segment' }, addKeyframes);
  assert.equal(receipts[0].terminalHolds, 1);
  assert.deepEqual(receipts[0].warnings, []);
  assert.equal(nativeCurveValue(segment.common_keyframes[0].keyframe_list, 2000000, 1), 0);
});
test('effect execution pins the exact catalog resource checked for cost', () => {
  const draft = { tracks: [{ id: 'video', segments: [{ id: 'segment' }] }], materials: {} };
  const entry = findEnum('scene_effects', 'chromatic');
  const receipt = writeCatalogEffect(draft, { slug: 'chromatic', start: 0, duration: 1, intensity: 0.7, params: [] }, 'segment', 'effect', { findEnum, addEffect });
  assert.equal(receipt.resourceId, entry.resource_id);
  assert.equal(draft.materials.video_effects[0].resource_id, entry.resource_id);
  assert.equal(draft.materials.video_effects[0].effect_id, entry.effect_id);
  assert.equal(receipt.nativePlaybackVerified, false);
});
test('specialists are selected by editing work and reports cannot invent technique IDs', () => {
  const plan = { source: { volume: 1, keyframes: [] }, texts: [], techniques: [technique] };
  assert.deepEqual(specialistAssignments(plan), []);
  assert.deepEqual(specialistAssignments(plan, { request: 'Add music. No captions, graphics or effects.' }), ['audio']);
  assert.deepEqual(specialistAssignments(plan, { request: 'No music, but add captions.' }), ['captions']);
  assert.deepEqual(specialistAssignments(plan, { request: 'Do not add captions. Keep the picture.' }), []);
  assert.deepEqual(specialistAssignments({ ...plan, texts: [{ keyframes: [] }] }, { referenceVideo: true, hasAudio: true, request: 'Match the beat and captions.' }), ['motion', 'captions', 'audio']);
  assert.throws(() => validateSpecialistReport({ summary: 'Advice', findings: [{ techniqueId: 'unknown' }] }, plan), /Invalid/);
});

test('visual-only repairs reuse audio checks, while changed audio and unknown failures invalidate them', () => {
  const plan = { version: 4, source: { volume: 1, keyframes: [] }, texts: [], techniques: [{ ...technique, components: ['overlay-0'] }] };
  const initial = specialistCacheKey('audio', plan, 'fixed evidence', 'Analyze the reference before building.');
  const visualRepair = JSON.stringify([{ component: 'overlay-0', expected: 'Cloud width 60%', observed: 'Cloud width 85%' }]);
  assert.equal(specialistCacheKey('audio', { ...plan, texts: [{ text: 'Changed title' }] }, 'fixed evidence', visualRepair), initial);
  assert.notEqual(specialistCacheKey('audio', { ...plan, source: { volume: 0.5, keyframes: [] } }, 'fixed evidence', visualRepair), initial);
  assert.notEqual(specialistCacheKey('audio', plan, 'fixed evidence', JSON.stringify([{ component: 'source audio', expected: 'Audible', observed: 'Silent' }])), initial);
  assert.notEqual(specialistCacheKey('audio', plan, 'fixed evidence', 'Unclassified failure'), initial);
});

test('local font discovery supplies bounded IDs and refuses arbitrary paths', t => {
  if (!['win32', 'darwin'].includes(process.platform)) { t.skip('Desktop system font discovery'); return; }
  const fonts = availableTextFonts();
  assert.ok(fonts.length > 0 && fonts.length <= 600);
  assert.equal(new Set(fonts.map(font => font.id)).size, fonts.length);
  for (const font of fonts) {
    assert.match(font.id, /^[a-z][a-z0-9-]{0,79}$/);
    assert.equal(resolveTextFont(font.id).path, font.path);
  }
  assert.throws(() => resolveTextFont('../../private.ttf'), /unavailable/);
  assert.throws(() => resolveTextFont('not-an-installed-font'), /unavailable/);
});

test('a passing first comparison stops immediately regardless of unused repair budget', () => {
  const matched = combineReviews([report(), report()], [technique], true, 'revision');
  assert.equal(qualityAction(matched, 1, 4), 'approve');
  const needsNative = combineReviews([report(), report()], [technique], false, 'revision');
  assert.equal(qualityAction(needsNative, 1, 4), 'needs-evidence');
});
test('technique bindings must refer to real components active in that interval', () => {
  const pose = { scale: 1, x: 0, y: 0, rotation: 0, opacity: 1, keyframes: [] };
  const plan = { version: 4, summary: 'Test', source: { ...pose, volume: 1 }, texts: [], assets: [], overlays: [], effects: [], resourceQueries: [], unsupported: [],
    techniques: [{ ...technique, evidence: 'Requested', confidence: 1, components: ['source'] }] };
  assert.equal(validateControlledPlan(plan, 1).version, 4);
  plan.techniques[0].components = ['effect-0'];
  assert.throws(() => validateControlledPlan(plan, 1), /missing or non-overlapping/);
});
