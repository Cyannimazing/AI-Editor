import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeClipEdit } from './merge-clip-edit.mjs';

function fixtures() {
  const clip = (id, start, material = 'original-video') => ({ id, material_id: material,
    target_timerange: { start, duration: 2_000_000 }, source_timerange: { start: 0, duration: 2_000_000 },
    clip: { scale: { x: 1, y: 1 }, transform: { x: 0, y: 0 }, rotation: 0, alpha: 1 },
    uniform_scale: { on: true, value: 1 }, common_keyframes: [], extra_material_refs: [], speed: 1, volume: 0.6, render_index: 0 });
  const original = { id: 'project', duration: 9_000_000, fps: 30,
    materials: { videos: [{ id: 'original-video', path: 'original.mp4', crop: { left: 0.1 } }], speeds: [], audios: [{ id: 'music', path: 'music.wav' }] },
    tracks: [{ id: 'footage', type: 'video', segments: [clip('before', 0), clip('selected', 4_000_000), clip('after', 7_000_000)] },
      { id: 'audio', type: 'audio', segments: [{ id: 'music-segment', material_id: 'music', target_timerange: { start: 0, duration: 9_000_000 } }] }] };
  const generated = { materials: { videos: [{ id: 'normalized-video', path: 'normalized.mp4' }, { id: 'overlay-video', path: 'overlay.mp4' }], speeds: [] },
    tracks: [{ id: 'new-source', type: 'video', segments: [clip('generated-source', 0, 'normalized-video')] },
      { id: 'overlay-track', type: 'video', segments: [{ ...clip('overlay', 200_000, 'overlay-video'), target_timerange: { start: 200_000, duration: 500_000 } }] }] };
  generated.tracks[0].segments[0].volume = 1;
  return { original, generated };
}

test('preserves surrounding clips/audio and offsets only added layers', () => {
  const { original, generated } = fixtures();
  const before = structuredClone(original);
  const merged = mergeClipEdit(original, generated, 'selected');
  assert.deepEqual(original, before);
  assert.deepEqual(merged.tracks[0].segments[0], before.tracks[0].segments[0]);
  assert.deepEqual(merged.tracks[0].segments[2], before.tracks[0].segments[2]);
  assert.deepEqual(merged.tracks.find((item) => item.id === 'audio'), before.tracks[1]);
  assert.equal(merged.duration, before.duration);
  assert.deepEqual(merged.tracks[0].segments[1].target_timerange, before.tracks[0].segments[1].target_timerange);
  assert.equal(merged.tracks[0].segments[1].id, 'selected');
  assert.equal(merged.tracks[0].segments[1].volume, 0.6);
  assert.equal(merged.tracks[1].segments[0].target_timerange.start, 4_200_000);
  assert.equal(merged.tracks[1].segments[0].volume, 0);
  assert.deepEqual(merged.materials.videos.find((item) => item.id === 'normalized-video').crop, { left: 0.1 });
});

test('keeps existing upper layers above the generated clip edit', () => {
  const { original, generated } = fixtures();
  const upper = { id: 'upper', type: 'video', segments: [{ id: 'existing-overlay', render_index: 10000,
    target_timerange: { start: 4_000_000, duration: 2_000_000 } }] };
  original.tracks.splice(1, 0, upper);
  const merged = mergeClipEdit(original, generated, 'selected');
  assert.deepEqual(merged.tracks.find((item) => item.id === 'upper'), upper);
  assert.ok(merged.tracks[1].segments[0].render_index > 0);
  assert.ok(merged.tracks[1].segments[0].render_index < 10000);
  assert.equal(merged.tracks[2].id, 'upper');
});

test('combines new motion with existing placement and retains unrelated keyframes', () => {
  const { original, generated } = fixtures();
  const selected = original.tracks[0].segments[1];
  selected.clip.transform.x = 0.25;
  selected.uniform_scale.value = 1.5;
  selected.common_keyframes = [{ property_type: 'KFTypeRotation', keyframe_list: [{ values: [12], time_offset: 0 }] }];
  const base = generated.tracks[0].segments[0];
  base.common_keyframes = [{ property_type: 'UNIFORM_SCALE', keyframe_list: [{ values: [1.2], time_offset: 1_000_000 }] }];
  const updated = mergeClipEdit(original, generated, 'selected').tracks[0].segments[1];
  assert.equal(updated.clip.transform.x, 0.25);
  assert.equal(updated.common_keyframes[1].keyframe_list[0].values[0], 1.2 * 1.5);
  assert.deepEqual(updated.common_keyframes[0], selected.common_keyframes[0]);
});

test('rejects layers outside the clip and scene-wide effects', () => {
  const { original, generated } = fixtures();
  generated.tracks[1].segments[0].target_timerange.start = 2_100_000;
  assert.throws(() => mergeClipEdit(original, generated, 'selected'), /outside/);
  generated.tracks[1].segments[0].target_timerange.start = 0;
  generated.tracks[1].type = 'effect';
  assert.throws(() => mergeClipEdit(original, generated, 'selected'), /outside/);
});

test('rejects missing selection and changed duration; remaps template ID collisions', () => {
  const { original, generated } = fixtures();
  assert.throws(() => mergeClipEdit(original, generated, 'missing'), /invalid/);
  generated.tracks[0].segments[0].target_timerange.duration = 3_000_000;
  assert.throws(() => mergeClipEdit(original, generated, 'selected'), /duration/);
  generated.tracks[0].segments[0].target_timerange.duration = 2_000_000;
  generated.materials.videos[0].id = 'original-video';
  generated.tracks[0].segments[0].material_id = 'original-video';
  const merged = mergeClipEdit(original, generated, 'selected');
  const selected = merged.tracks[0].segments[1];
  assert.notEqual(selected.material_id, 'original-video');
  assert.equal(merged.materials.videos.find((item) => item.id === selected.material_id).path, 'normalized.mp4');
  assert.equal(merged.tracks[0].segments[0].material_id, 'original-video');
});
