import test from 'node:test';
import assert from 'node:assert/strict';
import { preparePreviewPlan } from '../src/server/editing/preview-plan.mjs';

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
