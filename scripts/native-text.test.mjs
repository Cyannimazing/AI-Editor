import test from 'node:test';
import assert from 'node:assert/strict';
import { readNativeText, pixelsToNativeTextSize } from '../src/server/editing/native-text.mjs';
import { compileControlledSpec } from '../src/server/editing/controlled-plan.mjs';

const material = size => ({ font_size: size, content: JSON.stringify({ text: 'Saved wording', styles: [{ size, bold: true, italic: false,
  fill: { content: { solid: { color: [0, 0.5, 1] } } }, font: { path: 'approved-font.ttf' } }] }) });
test('portrait and landscape text use the same short-axis scale and preview reads saved material', () => {
  assert.equal(pixelsToNativeTextSize(36, 640, 360), 10);
  assert.equal(pixelsToNativeTextSize(36, 360, 640), 10);
  const text = readNativeText(material(4.353393085787452), 720, 1562);
  assert.ok(text.fontSize < 32, 'old failed draft must not appear as the requested 68px');
  assert.equal(text.text, 'Saved wording'); assert.equal(text.bold, true); assert.equal(text.color, '#0080ff');
  assert.equal(text.fontPath, 'approved-font.ttf');
  const pose = { scale: 1, x: 0, y: 0, rotation: 0, opacity: 1, keyframes: [] };
  const plan = { version: 2, summary: 'Type sizing', source: { ...pose, volume: 1 },
    texts: [{ ...pose, text: 'Title', start: 0, duration: 1, fontSizePx: 68, color: '#000000' }],
    techniques: [{ id: 'text', name: 'Title', start: 0, end: 1, evidence: 'Requested', confidence: 1 }], unsupported: [] };
  const spec = compileControlledSpec(plan, { source: '/job/source.mp4', width: 720, height: 1562, duration: 1 });
  assert.ok(Math.abs(spec.tracks[1].items[0].fontSize - 9.44444444444) < 1e-8);
});
test('unsupported or inconsistent native text is not disguised using planner values', () => {
  assert.throws(() => readNativeText({ ...material(10), font_size: 20 }, 720, 1280), /disagree/);
  assert.throws(() => readNativeText({ font_size: 10, content: '{"text":"x","styles":[]}' }, 720, 1280), /style layout/);
});
