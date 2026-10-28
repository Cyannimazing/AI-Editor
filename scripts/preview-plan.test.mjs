import test from 'node:test';
import assert from 'node:assert/strict';
import { preparePreviewPlan } from '../src/server/editing/preview-plan.mjs';
import { motionComposition } from '../src/server/editing/motion-preview.mjs';
import vm from 'node:vm';

test('delayed layers have their native pose before the first rounded video frame becomes visible', () => {
  const html = motionComposition([{ kind: 'photo', start: .066667, file: 'cloud.png', width: 460, height: 360,
    segment: { target_timerange: { duration: 33333 }, clip: { transform: { x: -1.38, y: .54 }, scale: { x: .639, y: .639 }, alpha: 1 } } }],
  { width: 540, height: 960, duration: 2.2, fps: 30 });
  const at = 2 / 30, poses = new Map();
  const tl = { set(id, pose, time) { if (time <= at) poses.set(id, pose); return tl; }, to() { return tl; } };
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  vm.runInNewContext(script, { gsap: { timeline: () => tl }, window: {} });
  assert.ok(poses.has('#motion-0'), 'pose must be initialized before visibility rounding at frame 2');
  assert.equal(poses.get('#motion-0').x, -372.59999999999997);
  assert.equal(poses.get('#motion-0').scaleX, .639);
});

test('proxy preserves native stacking even when foreground starts first and uses an explicit Windows font', () => {
  const graph = '[v0]null[vout];[1:v]null[ovsrc0];[vout][ovsrc0]overlay=x=0[ovout0];[2:v]null[ovsrc1];[ovout0][ovsrc1]overlay=x=0[ovout1];[ovout1]drawtext=text=hello[vt0]';
  const segment = (id, start) => ({ material_id: id, target_timerange: { start } });
  const draft = { tracks: [{ type: 'video', segments: [] }, { type: 'video', segments: [segment('background', 1)] },
    { type: 'video', segments: [segment('foreground', 0)] }], materials: { videos: [
    { id: 'background', path: import.meta.filename }, { id: 'foreground', path: import.meta.filename }] } };
  const plan = preparePreviewPlan({ args: ['-filter_complex', graph, '-map', '[vt0]'], filterComplex: graph, overlaySegments: 2 }, draft, 'C:\\Windows\\Fonts\\arial.ttf');
  assert.ok(plan.filterComplex.indexOf('[2:v]') < plan.filterComplex.indexOf('[1:v]'));
  assert.ok(plan.filterComplex.includes('[preview_layer_0][ovsrc0]overlay='));
  assert.ok(plan.filterComplex.includes("fontfile='C\\:/Windows/Fonts/arial.ttf'"));
  assert.equal(plan.args[1], plan.filterComplex);
  assert.equal(plan.previewKind, 'approximate');
  assert.throws(() => preparePreviewPlan({ args: ['-filter_complex', 'different'], filterComplex: graph }, draft, 'font.ttf'), /inconsistent/);
  assert.throws(() => preparePreviewPlan({ args: ['-filter_complex', graph], filterComplex: graph, overlaySegments: 2 }, draft, "bad';movie=/private"), /Unsafe/);
  const scripted = preparePreviewPlan({ args: ['-filter_complex_script', '/job/preview.filters'], filterScript: { path: '/job/preview.filters', content: graph }, filterComplex: graph, overlaySegments: 2 }, draft, '/fonts/Arial.ttf');
  assert.equal(scripted.args[1], '/job/preview.filters');
  assert.equal(scripted.filterScript.content, scripted.filterComplex);
  assert.ok(scripted.filterScript.content.includes('[preview_layer_0][ovsrc0]overlay='));
});
