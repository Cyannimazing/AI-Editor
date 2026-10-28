import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';

export function mergeClipEdit(original, generated, clipId, { compositionEffectIds = [] } = {}) {
  const draft = structuredClone(original);
  const originalIds = new Set();
  const remappedIds = new Map();
  function collect(value, visit) {
    if (!value || typeof value !== 'object') return;
    if (typeof value.id === 'string' && value.id) visit(value.id);
    for (const child of Object.values(value)) collect(child, visit);
  }
  collect(original, (id) => originalIds.add(id));
  collect(generated, (id) => { if (originalIds.has(id) && !remappedIds.has(id)) remappedIds.set(id, randomUUID()); });
  function remap(value) {
    if (typeof value === 'string') return remappedIds.get(value) ?? value;
    if (Array.isArray(value)) return value.map(remap);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, remap(child)]));
    return value;
  }
  generated = remap(generated);
  const track = draft.tracks.find((item) => item.type === 'video' && item.segments.some((segment) => segment.id === clipId));
  const selected = track?.segments.find((segment) => segment.id === clipId);
  const baseTrack = generated.tracks?.[0];
  const base = baseTrack?.segments?.[0];
  if (!selected || baseTrack?.type !== 'video' || baseTrack.segments.length !== 1 || !base) {
    throw new Error('The selected clip or generated source track is invalid.');
  }
  const start = selected.target_timerange.start;
  const duration = selected.target_timerange.duration;
  if (Math.abs(base.target_timerange.duration - duration) > 50_000 || base.target_timerange.start !== 0) {
    throw new Error('The generated edit changed the selected clip duration.');
  }
  const materialIndex = new Map(Object.values(generated.materials ?? {}).flatMap((items) => Array.isArray(items) ? items.filter((item) => item.id).map((item) => [item.id, item]) : []));
  const usedMaterials = new Set();
  const pendingMaterials = [];
  function referenceMaterials(value) {
    if (typeof value === 'string' && materialIndex.has(value) && !usedMaterials.has(value)) {
      usedMaterials.add(value);
      pendingMaterials.push(value);
    } else if (value && typeof value === 'object') {
      for (const child of Object.values(value)) referenceMaterials(child);
    }
  }
  referenceMaterials(generated.tracks);
  while (pendingMaterials.length) referenceMaterials(materialIndex.get(pendingMaterials.pop()));
  const existingIds = new Set(Object.values(draft.materials).flatMap((items) => Array.isArray(items) ? items.map((item) => item.id).filter(Boolean) : []));
  for (const [kind, allItems] of Object.entries(generated.materials ?? {})) {
    if (!Array.isArray(allItems)) continue;
    const items = allItems.filter((item) => usedMaterials.has(item.id));
    for (const item of items) {
      if (item.id && existingIds.has(item.id)) throw new Error('A generated material ID conflicts with the existing project.');
      if (item.id) existingIds.add(item.id);
    }
    draft.materials[kind] ??= [];
    draft.materials[kind].push(...structuredClone(items));
  }
  const oldSpeeds = new Set((original.materials.speeds ?? []).map((item) => item.id));
  const oldMaterial = original.materials.videos?.find((item) => item.id === selected.material_id);
  const newMaterial = draft.materials.videos?.find((item) => item.id === base.material_id);
  if (!oldMaterial || !newMaterial) throw new Error('A source video material is missing.');
  const mediaIdentity = Object.fromEntries(['id', 'path', 'duration', 'width', 'height', 'type', 'md5']
    .filter((key) => key in newMaterial).map((key) => [key, newMaterial[key]]));
  Object.assign(newMaterial, structuredClone(oldMaterial), mediaIdentity);
  const newProperties = new Set((base.common_keyframes ?? []).map((group) => group.property_type));
  selected.common_keyframes = [
    ...(selected.common_keyframes ?? []).filter((group) => !newProperties.has(group.property_type)),
    ...structuredClone(base.common_keyframes ?? []),
  ];
  selected.extra_material_refs = [...new Set([
    ...(selected.extra_material_refs ?? []).filter((id) => !oldSpeeds.has(id)),
    ...(base.extra_material_refs ?? []),
  ])];
  const before = selected.clip ?? {};
  const after = base.clip ?? {};
  selected.clip = {
    ...before,
    scale: { x: (before.scale?.x ?? 1) * (after.scale?.x ?? 1), y: (before.scale?.y ?? 1) * (after.scale?.y ?? 1) },
    transform: { x: (before.transform?.x ?? 0) + (after.transform?.x ?? 0), y: (before.transform?.y ?? 0) + (after.transform?.y ?? 0) },
    rotation: (before.rotation ?? 0) + (after.rotation ?? 0),
    alpha: (before.alpha ?? 1) * (after.alpha ?? 1),
  };
  const valueBases = {
    KFTypeScaleX: [before.scale?.x ?? 1, 0], KFTypeScaleY: [before.scale?.y ?? 1, 0],
    UNIFORM_SCALE: [selected.uniform_scale?.value ?? 1, 0],
    KFTypePositionX: [1, before.transform?.x ?? 0], KFTypePositionY: [1, before.transform?.y ?? 0],
    KFTypeRotation: [1, before.rotation ?? 0], KFTypeAlpha: [before.alpha ?? 1, 0], KFTypeVolume: [selected.volume ?? 1, 0],
  };
  for (const group of selected.common_keyframes.filter((item) => newProperties.has(item.property_type))) {
    const [scale, shift] = valueBases[group.property_type] ?? [1, 0];
    for (const frame of group.keyframe_list ?? []) {
      if (frame.time_offset < 0 || frame.time_offset > duration + 50_000) throw new Error('A generated keyframe is outside the selected clip.');
      frame.values = frame.values.map((value) => value * scale + shift);
      for (const control of [frame.left_control, frame.right_control]) if (control) control.y *= scale;
    }
  }
  selected.uniform_scale = { ...(selected.uniform_scale ?? {}), ...(base.uniform_scale ?? {}),
    value: (selected.uniform_scale?.value ?? 1) * (base.uniform_scale?.value ?? 1) };
  selected.material_id = base.material_id;
  selected.source_timerange = structuredClone(base.source_timerange);
  selected.speed = base.speed ?? 1;
  selected.reverse = false;
  selected.volume = (selected.volume ?? 1) * (base.volume ?? 1);
  selected.keyframe_refs = [...(selected.keyframe_refs ?? []), ...(base.keyframe_refs ?? [])];

  const existingSegments = draft.tracks.flatMap((item) => item.segments);
  const baseRender = selected.render_index ?? 0;
  const nextRender = Math.min(...existingSegments.map((segment) => segment.render_index ?? 0).filter((value) => value > baseRender));
  const layerRanks = [...new Set(generated.tracks.slice(1).flatMap((item) => item.segments.map((segment) => segment.render_index ?? 0)))].sort((a, b) => a - b);
  const step = Number.isFinite(nextRender) ? Math.floor((nextRender - baseRender) / (layerRanks.length + 1)) : 1000;
  if (layerRanks.length && step < 1) throw new Error('The selected clip has no free layer ordering space below its existing overlays.');
  const renderOrder = new Map(layerRanks.map((value, index) => [value, baseRender + step * (index + 1)]));
  const ids = new Set([...draft.tracks.map((item) => item.id), ...existingSegments.map((item) => item.id)]);
  const addedTracks = [];
  for (const generatedTrack of generated.tracks.slice(1)) {
    const added = structuredClone(generatedTrack);
    if (ids.has(added.id)) throw new Error('A generated track ID conflicts with the existing project.');
    ids.add(added.id);
    for (const segment of added.segments) {
      if (ids.has(segment.id)) throw new Error('A generated segment ID conflicts with the existing project.');
      ids.add(segment.id);
      const range = segment.target_timerange;
      const editedIds = new Set([clipId, ...generated.tracks.slice(1).flatMap(track => track.segments.map(segment => segment.id))]);
      const scopedEffect = ['effect', 'filter'].includes(added.type) && Object.values(generated.materials).some(items => Array.isArray(items) && items.some(material => material.id === segment.material_id && (
        material.apply_target_type === 0 && editedIds.has(material.bind_segment_id) ||
        material.apply_target_type === 2 && !material.bind_segment_id && compositionEffectIds.includes(material.id) &&
        !original.tracks.filter(t => t.type !== 'audio').flatMap(t => t.segments || []).some(s => s.id !== clipId &&
          s.target_timerange.start < start + range.start + range.duration && s.target_timerange.start + s.target_timerange.duration > start + range.start))));
      if ((['effect', 'filter'].includes(added.type) && !scopedEffect) || range.start < 0 || range.duration <= 0 || range.start >= duration || range.start + range.duration > duration + 50_000) {
        throw new Error('A generated layer falls outside the selected clip.');
      }
      range.duration = Math.min(range.duration, duration - range.start);
      range.start += start;
      segment.render_index = renderOrder.get(segment.render_index ?? 0);
      if (added.type === 'video') segment.volume = 0;
    }
    addedTracks.push(added);
  }
  draft.tracks.splice(draft.tracks.indexOf(track) + 1, 0, ...addedTracks);
  return draft;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [destination, generatedPath, clipId] = process.argv.slice(2);
  if (!destination || !generatedPath || !clipId) throw new Error('Expected destination, generated project, and clip ID.');
  const { loadDraft, saveDraft } = await import('../toolchain/node_modules/capcut-cli/dist/draft.js');
  const { draft, filePath } = loadDraft(destination, { activeTimeline: true });
  const generated = loadDraft(generatedPath).draft;
  const merged = mergeClipEdit(draft, generated, clipId);
  saveDraft(filePath, merged, { preserveProjectFields: true });
  process.stdout.write(JSON.stringify({ ok: true, clipId, addedTracks: generated.tracks.length - 1 }));
}
