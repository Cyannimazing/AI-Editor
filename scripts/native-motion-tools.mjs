import { randomUUID } from 'node:crypto';

export function pixelOffset(dx, dy, width, height) {
  if (![dx, dy, width, height].every(Number.isFinite) || width <= 0 || height <= 0) throw new Error('Invalid canvas coordinates.');
  return { x: 2 * dx / width, y: -2 * dy / height };
}

export function textSizeHint(pixelSize, canvasHeight) {
  if (!Number.isFinite(pixelSize) || pixelSize <= 0 || !Number.isFinite(canvasHeight) || canvasHeight <= 0) throw new Error('Invalid text measurements.');
  return pixelSize * 320 / canvasHeight;
}

export function useScaleAxes(segment) {
  const groups = segment.common_keyframes ?? [];
  const uniform = groups.find((group) => group.property_type === 'UNIFORM_SCALE');
  if (!uniform?.keyframe_list?.length) return false;
  segment.common_keyframes = groups.filter((group) => !['UNIFORM_SCALE', 'KFTypeScaleX', 'KFTypeScaleY'].includes(group.property_type));
  for (const property_type of ['KFTypeScaleX', 'KFTypeScaleY']) {
    segment.common_keyframes.push({ ...structuredClone(uniform), id: randomUUID(), property_type,
      keyframe_list: uniform.keyframe_list.map((frame) => ({ ...structuredClone(frame), id: randomUUID() })) });
  }
  const first = uniform.keyframe_list[0].values[0];
  segment.clip = { ...segment.clip, scale: { x: first, y: first } };
  segment.uniform_scale = { on: false, value: first };
  return true;
}

export function frameRanges(durationUs, fps, startUs = 0) {
  if (![durationUs, fps, startUs].every(Number.isFinite) || durationUs <= 0 || fps <= 0 || fps > 240 || startUs < 0) throw new Error('Invalid native frame timing.');
  const ranges = [];
  for (let frame = 0; Math.round(frame * 1_000_000 / fps) < durationUs; frame++) {
    const local = Math.round(frame * 1_000_000 / fps);
    const end = Math.min(Math.round((frame + 1) * 1_000_000 / fps), durationUs);
    ranges.push({ frame, start: startUs + local, duration: end - local });
  }
  return ranges;
}

export function fixedPhaseSegments(template, phases, fps, effectMaterialIds) {
  if (!Array.isArray(effectMaterialIds)) throw new Error('Pass the complete list of prior effect material IDs so rest phases cannot inherit blur.');
  const range = template.target_timerange;
  const frames = frameRanges(range.duration, fps, range.start);
  if (phases.length !== frames.length) throw new Error('Provide one measured phase per native frame.');
  const effects = new Set(effectMaterialIds);
  return frames.map((timing, index) => {
    const segment = structuredClone(template);
    segment.id = randomUUID();
    segment.target_timerange = { start: timing.start, duration: timing.duration };
    if (segment.source_timerange) segment.source_timerange = {
      start: segment.source_timerange.start + Math.round((timing.start - range.start) * (segment.speed ?? 1)),
      duration: Math.round(timing.duration * (segment.speed ?? 1)),
    };
    segment.common_keyframes = [];
    segment.keyframe_refs = [];
    segment.extra_material_refs = (segment.extra_material_refs ?? []).filter((id) => !effects.has(id));
    const phase = phases[index];
    segment.clip = { ...segment.clip, ...structuredClone(phase.clip ?? {}) };
    segment.extra_material_refs.push(...(phase.effectRefs ?? []));
    return segment;
  });
}
