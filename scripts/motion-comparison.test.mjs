import test from 'node:test';
import assert from 'node:assert/strict';
import { guardSourceMotion, motionCheckTimes, motionCurveReport, compareSourceMotion, plannedMotionDynamics } from '../src/server/editing/motion-comparison.mjs';
import { motionPython } from '../src/server/editing/motion-runtime.mjs';
import { sourceCoverage, includeMotionDefects, coverageDefects, feasibleFraming } from '../src/server/editing/motion-coverage.mjs';
import { editingScope, assertEditingScope } from '../src/server/editing/edit-scope.mjs';

const source = (scale = 1) => ({ scale: 1, x: 0, y: 0, rotation: 0, opacity: 1, volume: 1,
  keyframes: [{ property: 'scale', time: 0, value: scale, easing: 'linear' }, { property: 'scale', time: 0.2, value: 1, easing: 'linear' }] });
const plan = value => ({ source: source(value), texts: [], overlays: [], effects: [] });
const measurement = { samples: [{ time: 0, status: 'matched', directlyApplicable: true, transform: { scale: 0.78, x: 0.23, y: -0.03, rotation: 0 } }] };

test('continuous zoom diagnostics distinguish constant travel from repeated easing stops and end holds', () => {
  const p = plan(1);
  p.source.keyframes = [0, 1, 2, 3].map((time, i) => ({ property: 'scale', time, value: 1 + Math.min(i, 2) * .1, easing: 'linear' }));
  const linear = plannedMotionDynamics(p, { fps: 30, duration: 3 });
  const scale = linear[0].curves.find(c => c.property === 'KFTypeScaleX');
  assert.equal(scale.intervals[0].startRate, scale.intervals[0].endRate);
  assert.equal(scale.intervals[2].kind, 'hold');
  assert.deepEqual(scale.intervals[2].range, [2, 3]);
  assert.equal(scale.stopCandidates.length, 0);
  p.source.keyframes.forEach(k => k.easing = 'ease-in-out');
  const eased = plannedMotionDynamics(p, { fps: 30, duration: 3 })[0].curves.find(c => c.property === 'KFTypeScaleX');
  assert.ok(eased.stopCandidates.some(c => c.time === 1));
  assert.ok(eased.intervals[0].midRate > eased.intervals[0].endRate * 3);
  assert.equal(p.source.keyframes.length, 4, 'diagnostics never rewrite the editor plan');
  p.source.keyframes = p.source.keyframes.slice(0, 2);
  const tail = plannedMotionDynamics(p, { fps: 30, duration: 3 })[0].curves[0].intervals.at(-1);
  assert.equal(tail.kind, 'hold');
  assert.deepEqual(tail.range, [1, 3], 'native last-value retention is visible to reviewers');
});

test('a crop repair cannot regress measured motion or erase unrelated successful changes', () => {
  const previous = plan(1), proposed = plan(1.24);
  proposed.source.keyframes.push({ property: 'brightness', time: 0.1, value: 0.2, easing: 'linear' });
  proposed.texts.push({ text: 'Corrected wording' });
  const guarded = guardSourceMotion(previous, proposed, measurement, { width: 720, height: 1562 });
  assert.equal(guarded.reverted, true);
  assert.equal(guarded.plan.source.keyframes.find(frame => frame.property === 'scale').value, 1);
  assert.equal(guarded.plan.source.keyframes.find(frame => frame.property === 'brightness').value, 0.2);
  assert.deepEqual(guarded.plan.texts, proposed.texts);
  assert.equal(proposed.source.keyframes[0].value, 1.24, 'guard does not mutate planner evidence');
  assert.ok(guarded.regressions[0].rmsPixels > guarded.regressions[0].previousRmsPixels);
});

test('improved motion and unmeasurable style references are not overwritten', () => {
  assert.equal(guardSourceMotion(plan(1.24), plan(0.8), measurement, { width: 720, height: 1562 }).reverted, false);
  assert.equal(guardSourceMotion(plan(1), plan(1.24), { samples: [{ time: 0, status: 'unmatched' }] }, { width: 720, height: 1562 }).reverted, false);
  assert.equal(guardSourceMotion(null, plan(1), measurement, { width: 720, height: 1562 }).reverted, false);
});

test('comparison uses native signed coordinates and serialized movement rather than the static pose', () => {
  const segment = { id: 'clip', target_timerange: { start: 2000000, duration: 1000000 }, clip: { scale: { x: 2, y: 2 } }, common_keyframes: [
    { property_type: 'KFTypeScaleX', keyframe_list: [{ time_offset: 0, values: [0.78] }] },
    { property_type: 'KFTypeScaleY', keyframe_list: [{ time_offset: 0, values: [0.78] }] },
    { property_type: 'KFTypePositionX', keyframe_list: [{ time_offset: 0, values: [0.23] }] },
    { property_type: 'KFTypePositionY', keyframe_list: [{ time_offset: 0, values: [-0.03] }] },
  ] };
  assert.equal(compareSourceMotion(segment, measurement, 720, 1562)[0].rmsPixels, 0);
  const report = motionCurveReport(plan(0.78), { tracks: [{ segments: [segment] }] }, { source: 'clip' }, measurement, { width: 720, height: 1562, duration: 1 });
  assert.equal(report.components[0].samples[0].x, 82.8);
  assert.equal(report.components[0].samples[0].y, 23.43);
  assert.equal(report.nativeVerified, false);
});

test('motion evidence includes rapid reversals, settling and the ending with bounded images', () => {
  const p = plan(1);
  p.overlays.push({ start: 0, keyframes: [0, 1 / 30, 2 / 30, 4 / 30, 5 / 30, 6 / 30, 2.2].map((time, i) => ({ property: 'x', time, value: i % 2, easing: 'linear' })) });
  const times = motionCheckTimes(p, 2.2, 30);
  assert.equal(times.length, 8);
  for (const time of [0, 1 / 30, 2 / 30, 4 / 30, 5 / 30, 6 / 30, 65 / 30]) assert.ok(times.includes(time));
  assert.equal(new Set(times).size, times.length);
  assert.ok(motionPython('/app', 'darwin').endsWith('motion-python\\bin\\python3') || motionPython('/app', 'darwin').endsWith('motion-python/bin/python3'));
  assert.ok(motionPython('/app', 'win32').endsWith('Scripts\\python.exe') || motionPython('/app', 'win32').endsWith('Scripts/python.exe'));
});

test('infeasible fits and existing coverage defects cannot lock broken source keyframes', () => {
  const bounds = { left: 0, top: 0.1, right: 1, bottom: 0.9 };
  const report = { samples: [{ ...measurement.samples[0], directlyApplicable: false, sourceBounds: bounds, referenceBounds: bounds }] };
  const repaired = guardSourceMotion(plan(0.78), plan(1), report, { width: 720, height: 1562 });
  assert.equal(repaired.reverted, false);
  assert.equal(repaired.plan.source.keyframes[0].value, 1);
  const oldReceipt = { samples: [{ ...measurement.samples[0], directlyApplicable: undefined }] };
  assert.equal(guardSourceMotion(plan(0.78), plan(1.24), oldReceipt, { width: 720, height: 1562 }).reverted, false);
});

test('coverage respects native coordinates and exposes gaps across the actual picture, not mattes', () => {
  const bounds = { left: 0, top: 0.1, right: 1, bottom: 0.9 };
  const report = { samples: [{ time: 0, status: 'matched', sourceBounds: bounds, referenceBounds: bounds }] };
  const segment = scale => ({ clip: { scale: { x: scale, y: scale } } });
  assert.equal(sourceCoverage(segment(1), report, 720, 1562)[0].uncoveredFraction, 0);
  assert.ok(sourceCoverage(segment(0.78), report, 720, 1562)[0].uncoveredFraction > 0.3);
  const defects = coverageDefects(sourceCoverage(segment(0.78), report, 720, 1562), 'test pixels');
  const goodAi = { decision: 'ready', defects: [], techniques: [{ id: 'motion', status: 'matched' }] };
  assert.equal(includeMotionDefects(goodAi, defects).decision, 'revise');
  assert.equal(includeMotionDefects(goodAi, defects).defects.length, 1);
  assert.equal(includeMotionDefects(goodAi, []).decision, 'ready', 'passing output adds no correction round');
});

test('framing alternatives cover rotated picture corners without inventing missing source pixels', () => {
  const bounds = { left: 0, top: 0.09, right: 1, bottom: 0.91 };
  for (const rotation of [0, 8, -12]) {
    const sample = { time: 0, status: 'matched', sourceBounds: bounds, referenceBounds: bounds,
      transform: { scale: 0.78, x: 0.23, y: -0.03, rotation } };
    const original = structuredClone(sample);
    const fit = feasibleFraming(sample, 720, 1562);
    const segment = { clip: { scale: { x: fit.scale, y: fit.scale }, transform: { x: fit.x, y: fit.y }, rotation: fit.rotation } };
    assert.equal(sourceCoverage(segment, { samples: [sample] }, 720, 1562)[0].uncoveredFraction, 0);
    assert.deepEqual(sample, original, 'the observation is preserved beside its explicitly labelled alternative');
  }
});

test('keyframes-only scope rejects effect/color/audio work before any plugin or compiler mutation', () => {
  for (const request of ['Keyframes only. No effects.', 'Only the keyframes please.', 'No effects, just perfect the keyframes.']) assert.equal(editingScope(request), 'keyframes');
  assert.equal(editingScope('Add RGB to video, no effects on text.'), 'full');
  const p = plan(1); p.resourceQueries = [];
  assert.doesNotThrow(() => assertEditingScope(p, 'keyframes'));
  p.effects.push({ slug: 'motion-blur' });
  assert.throws(() => assertEditingScope(p, 'keyframes'), /remove effect tracks/);
  assert.doesNotThrow(() => assertEditingScope(p, 'full'));
  p.effects = []; p.source.keyframes.push({ property: 'brightness', time: 0, value: 0.2, easing: 'linear' });
  assert.throws(() => assertEditingScope(p, 'keyframes'), /brightness/);
  p.source.keyframes = []; p.resourceQueries.push({ kind: 'video_effect', query: 'smear' });
  assert.throws(() => assertEditingScope(p, 'keyframes'), /material queries/);
});
