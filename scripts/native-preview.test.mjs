import test from 'node:test';
import assert from 'node:assert/strict';
import { previewGeometry, playerFrame, previewSchedule, navigationSteps } from '../src/server/capcut/native-preview-policy.mjs';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { directoryDigest } from '../src/server/editing/transaction.ts';
import { assertNativeEvidence, fileDigest } from '../src/server/capcut/native-capture.mjs';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { assertDraftEquivalent } from '../src/server/capcut/native-equivalence.mjs';

test('Mac capture rejects moved, closed, replaced and unfocused windows', async () => {
  const source = await readFile(new URL('./native-ui-macos.js', import.meta.url), 'utf8');
  const definition = source.slice(source.indexOf('function assertStableWindow('), source.indexOf('// macOS normally'));
  const check = vm.runInNewContext(`${definition}; assertStableWindow`);
  const win = { kCGWindowNumber: 41, kCGWindowOwnerPID: 9, kCGWindowOwnerName: 'CapCut', kCGWindowBounds: { X: -1200, Y: 20, Width: 1200, Height: 900 } };
  check(win, structuredClone(win), true);
  for (const current of [null, { ...win, kCGWindowNumber: 42 }, { ...win, kCGWindowOwnerPID: 10 },
    { ...win, kCGWindowOwnerName: 'Another app' }, { ...win, kCGWindowBounds: { ...win.kCGWindowBounds, X: 0 } },
    { ...win, kCGWindowBounds: { ...win.kCGWindowBounds, Width: 1000 } }]) assert.throws(() => check(win, current, true), /interrupted/);
  assert.throws(() => check(win, win, false), /interrupted/);
});

test('native serialization tolerates fractional-frame rounding and an empty global binding, never a different target or frame', async () => {
  const original = { fps: 30, materials: { video_effects: [{ id: 'fx', apply_target_type: 2 }] }, tracks: [{ type: 'effect',
    segments: [{ id: 'effect', material_id: 'fx', target_timerange: { start: 33333, duration: 66667 }, extra_material_refs: [] }] }] };
  const saved = structuredClone(original);
  saved.materials.video_effects[0].bind_segment_id = '';
  saved.tracks[0].segments[0].target_timerange.duration = 66666;
  await assertDraftEquivalent(original, saved, { nativeSave: true });
  const retargeted = structuredClone(saved); retargeted.materials.video_effects[0].bind_segment_id = 'other-clip';
  await assert.rejects(assertDraftEquivalent(original, retargeted, { nativeSave: true }), /differs/);
  const shifted = structuredClone(saved); shifted.tracks[0].segments[0].target_timerange.start = 66667;
  await assert.rejects(assertDraftEquivalent(original, shifted, { nativeSave: true }), /differs/);
  const nonGrid = structuredClone(original); nonGrid.tracks[0].segments[0].target_timerange.start = 34567;
  const changed = structuredClone(nonGrid); changed.tracks[0].segments[0].target_timerange.start++;
  await assert.rejects(assertDraftEquivalent(nonGrid, changed, { nativeSave: true }), /differs/);
});

test('native save accepts exact defaults but rejects added motion, gain, effects and unknown controls', async () => {
  const original = { fps: 30, canvas_config: { width: 640, height: 360 },
    tracks: [{ type: 'video', segments: [{ id: 'a', material_id: 'v', render_index: 14000, track_render_index: 0, clip: { rotation: 0, alpha: 1 }, extra_material_refs: [] }] }],
    materials: { videos: [{ id: 'v', mix_mode: 'Normal' }], masks: [] } };
  const saved = structuredClone(original);
  saved.canvas_config.background = null; saved.tracks[0].segments[0].render_index = 0;
  saved.tracks[0].segments[0].state = 0; saved.tracks[0].segments[0].is_loop = false;
  delete saved.materials.videos[0].mix_mode; delete saved.materials.masks;
  await assertDraftEquivalent(original, saved, { nativeSave: true });
  for (const change of [s => s.clip.rotation = 90, s => s.volume = 0, s => s.unknown_control = 0, s => s.is_loop = true,
    s => s.common_keyframes = [{ property_type: 'KFTypePositionX', keyframe_list: [{ time_offset: 0, values: [.5] }] }]]) {
    const bad = structuredClone(saved); change(bad.tracks[0].segments[0]);
    await assert.rejects(assertDraftEquivalent(original, bad, { nativeSave: true }), /differs/);
  }
  const fx = structuredClone(saved); fx.materials.video_effects = [{ id: 'fx', resource_id: '123', adjust_params: [] }];
  await assert.rejects(assertDraftEquivalent(original, fx, { nativeSave: true }), /differs/);
  const chained = structuredClone(original);
  chained.materials.video_effects = [{ id: 'one' }, { id: 'two' }];
  chained.tracks[0].segments[0].extra_material_refs = ['one', 'two'];
  const reordered = structuredClone(chained); reordered.tracks[0].segments[0].extra_material_refs.reverse();
  await assert.rejects(assertDraftEquivalent(chained, reordered, { nativeSave: true }), /differs/);
});

test('published inspection preserves authored text, timing, motion and resource bytes across relocation', async t => {
  const root = await mkdtemp(join(tmpdir(), 'published-proof-')); t.after(() => rm(root, { recursive: true, force: true }));
  const a = join(root, 'a.png'), b = join(root, 'b.png'); await writeFile(a, 'same'); await writeFile(b, 'same');
  const original = { id: 'a', name: 'a', canvas_config: { width: 640, height: 360 }, tracks: [{ segments: [{ id: 'clip', material_id: 'text', render_index: 14000, target_timerange: { start: 0, duration: 9000000 }, clip: { transform: { x: .2 } } }] }], materials: { texts: [{ id: 'text', content: 'Long exact wording' }], videos: [{ id: 'image', path: a }] } };
  const published = structuredClone(original); published.id = 'b'; published.name = 'b'; published.materials.videos[0].path = b;
  await assertDraftEquivalent(original, published);
  const shortened = structuredClone(published); shortened.tracks[0].segments[0].target_timerange.duration = 7000000;
  await assert.rejects(assertDraftEquivalent(original, shortened), /differs/);
  const moved = structuredClone(published); moved.tracks[0].segments[0].clip.transform.x = 0;
  await assert.rejects(assertDraftEquivalent(original, moved, true), /differs/);
  const saved = structuredClone(published); saved.canvas_config.background = null; saved.tracks[0].segments[0].render_index = 0; saved.tracks[0].segments[0].state = 0;
  await assert.rejects(assertDraftEquivalent(original, saved), /differs/);
  const newControl = structuredClone(published); newControl.tracks[0].segments[0].clip.rotation = 90;
  await assert.rejects(assertDraftEquivalent(original, newControl), /differs/);
  saved.tracks.push({ segments: [] }); await assert.rejects(assertDraftEquivalent(original, saved, true), /differs/);
  await writeFile(b, 'changed'); await assert.rejects(assertDraftEquivalent(original, published), /differs/);
});

test('Mac player panels come from the matching accessibility window, with bounded traversal and Retina scaling', async () => {
  const context = vm.createContext({ ObjC: { import() {} } });
  vm.runInContext(await readFile(new URL('./native-ui-macos.js', import.meta.url), 'utf8'), context);
  const node = (position, size, children = []) => ({ position: () => position, size: () => size, uiElements: () => children });
  const child = node([550, 179], [409, 249]);
  const root = node([100, 100], [1280, 720], [child]);
  const panels = context.accessibilityPanels([root], { X: 100, Y: 100, Width: 1280, Height: 720 }, 2);
  assert.equal(panels.length, 1); assert.equal(panels[0].x, 900); assert.equal(panels[0].y, 158);
  assert.equal(panels[0].width, 818);
  assert.throws(() => context.accessibilityPanels([root, root], { X: 100, Y: 100, Width: 1280, Height: 720 }, 2), /window/);
  const cycle = node([550, 179], [409, 249]); cycle.uiElements = () => [cycle];
  assert.throws(() => context.accessibilityPanels([node([100, 100], [1280, 720], [cycle])], { X: 100, Y: 100, Width: 1280, Height: 720 }, 1), /bounded/);
});

const state = { width: 1280, height: 720, scale: 1, window: 1,
  words: [{ text: 'Player-Timeline 01', x: 454, y: 51, width: 99, height: 13 }],
  panels: [{ window: 1, x: 0, y: 0, width: 1280, height: 720 }, { window: 2, x: 450, y: 79, width: 409, height: 249 }] };
test('player geometry uses observed viewport and preserves canvas aspect on Retina displays', () => {
  const g = previewGeometry(state, 640, 360);
  assert.ok(Math.abs(g.crop.width / g.crop.height - 640 / 360) < .02);
  assert.equal(g.clock.x, 446);
  const retina = { ...state, width: 2560, height: 1440, scale: 2,
    words: state.words.map(w => ({ ...w, x: w.x * 2, y: w.y * 2, width: w.width * 2, height: w.height * 2 })),
    panels: state.panels.map(p => ({ ...p, x: p.x * 2, y: p.y * 2, width: p.width * 2, height: p.height * 2 })) };
  assert.equal(previewGeometry(retina, 640, 360).clock.x, g.clock.x * 2);
  assert.throws(() => previewGeometry({ ...state, panels: [] }, 640, 360), /viewport/);
  assert.throws(() => previewGeometry({ ...state, panels: [...state.panels, { ...state.panels[1], x: 455, window: 3 }] }, 640, 360), /viewport/);
});
test('timecode parsing rejects wrong, ambiguous and malformed frames rather than guessing', () => {
  const clock = { x: 446, y: 356, width: 180, height: 40 };
  const w = { x: 450, y: 371, width: 64, height: 9, text: '000000:15' };
  assert.equal(playerFrame([w, { ...w, text: '00:00:03:00', x: 525 }], clock, 30), 15);
  assert.equal(playerFrame([{ ...w, text: '00:00:00:00' }], clock, 30), 0);
  assert.throws(() => playerFrame([{ ...w, text: '00:00:00:31' }], clock, 30), /timecode/);
  assert.throws(() => playerFrame([w, { ...w, text: '00:00:00:16' }], clock, 30), /ambiguous/);
  assert.throws(() => playerFrame([{ ...w, text: 'O0:00:00:15' }], clock, 30), /timecode/);
});
test('short previews inspect every frame; long requests have an explicit bounded sample rate', () => {
  const s = previewSchedule(0, 2.2, 30);
  assert.equal(s.frames.length, 66); assert.equal(s.frames.at(-1), 65);
  const long = previewSchedule(5, 60, 30);
  assert.ok(long.frames.length <= 90); assert.equal(long.frames[0], 150);
  assert.throws(() => previewSchedule(0, 0, 30), /interval/);
});

test('later timeline selections seek in bounded verifiable chunks', () => {
  const steps = navigationSteps(0, 4500, true);
  assert.equal(steps.at(-1).expected, 4500);
  assert.ok(steps.every(s => s.frames <= 1000));
  assert.equal(steps.filter(s => s.reset).length, 1);
  assert.deepEqual(navigationSteps(4500, 4501, false), [{ frames: 1, expected: 4501, reset: false }]);
  assert.throws(() => navigationSteps(10, 9, false), /navigation/);
});

test('native player evidence cannot pass after frame/candidate changes or an incomplete capture', async t => {
  const root = await mkdtemp(join(tmpdir(), 'player-proof-')); t.after(() => rm(root, { recursive: true, force: true }));
  const candidate = join(root, 'candidate'); await mkdir(candidate); await writeFile(join(candidate, 'draft.json'), 'fixture');
  const frame = join(root, 'frame.png'); await writeFile(frame, 'fixture pixels');
  const path = join(root, 'receipt.json');
  const receipt = { kind: 'capcut-native-preview', status: 'captured', platform: process.platform, candidateDigest: await directoryDigest(candidate),
    capcutVersion: 'fixture', exported: false, uploaded: false, samples: [{ frame: 0, path: frame }], assets: [], evidenceFiles: [{ path: frame, sha256: await fileDigest(frame) }] };
  await writeFile(path, JSON.stringify(receipt)); await assertNativeEvidence(root, candidate, path);
  await writeFile(frame, 'changed'); await assert.rejects(assertNativeEvidence(root, candidate, path), /changed/);
  await writeFile(frame, 'fixture pixels');
  for (const change of [{ status: 'capturing' }, { uploaded: true }, { samples: [] }, { evidenceFiles: [] }]) {
    await writeFile(path, JSON.stringify({ ...receipt, ...change })); await assert.rejects(assertNativeEvidence(root, candidate, path), /incomplete/);
  }
});
