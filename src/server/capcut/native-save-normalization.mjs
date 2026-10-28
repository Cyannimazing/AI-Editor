import defaults from './native-save-defaults.json' with { type: 'json' };
import { isDeepStrictEqual } from 'node:util';

// Exact defaults observed in a disposable CapCut 9.6 Windows calibration.
// Unknown additions and non-default values remain visible to the strict comparator.
// This table is never learned from an editing job or used to repair a project.
const inert = {
  speeds: { type: 'speed', speed: 1, mode: 0, curve_speed: null },
  placeholder_infos: { type: 'placeholder_info', error_path: '', error_text: '', meta_type: 'none', res_path: '', res_text: '' },
  sound_channel_mappings: { type: 'none', audio_channel_mapping: 0, is_config_open: false },
  vocal_separations: { type: 'vocal_separation', choice: 0, enter_from: '', final_algorithm: '', production_path: '', removed_sounds: [], time_range: null },
  loudnesses: { enable: false, time_range: null, file_id: '', target_loudness: 0, loudness_param: null },
};
function stripDefaults(value, path = '') {
  if (!value || typeof value !== 'object') return;
  for (const key of Object.keys(value)) {
    const child = `${path}.${path === '.tracks' ? value[key].type : Array.isArray(value) ? '*' : key}`;
    if (Object.hasOwn(defaults, child) && isDeepStrictEqual(value[key], defaults[child])) delete value[key];
    else stripDefaults(value[key], child);
  }
}
export function normalizeNativeSave(draft) {
  stripDefaults(draft);
  const gridTime = value => {
    if (!Number.isInteger(value) || !Number.isFinite(draft.fps) || draft.fps < 1) return value;
    const frame = Math.round(value * draft.fps / 1e6), exact = frame * 1e6 / draft.fps;
    // Native serialization alternates floor/ceil at fractional frame boundaries.
    // Never round an arbitrary requested edit to a different frame.
    return Math.abs(value - exact) <= 1.001 ? Math.round(exact) : value;
  };
  const removed = new Set();
  for (const [category, list] of Object.entries(draft.materials || {})) {
    if (!Array.isArray(list)) continue;
    if (inert[category]) draft.materials[category] = list.filter(material => {
      const { id, ...payload } = material;
      if (!isDeepStrictEqual(payload, inert[category])) return true;
      removed.add(id); return false;
    });
    for (const material of draft.materials[category]) {
      if (category === 'video_effects' && material.apply_target_type === 2 && material.bind_segment_id === '') delete material.bind_segment_id;
      if (category === 'material_colors' && material.type === 'material_color') delete material.type;
      if (['videos', 'audios'].includes(category)) {
        material.duration = gridTime(material.duration);
        if (material.mix_mode === 'Normal') delete material.mix_mode;
        // Native media indexing identity; never a control or media byte identity.
        if (/^[a-f\d]{32}$/i.test(material.unique_id || '')) delete material.unique_id;
      }
    }
    if (!draft.materials[category].length) delete draft.materials[category];
  }
  for (const [index, track] of (draft.tracks || []).entries()) {
    // CapCut labels secondary video lanes on first open. Array order is retained.
    if (index > 0 && track.type === 'video' && track.flag === 2) track.flag = 0;
    for (const segment of track.segments || []) {
      for (const range of [segment.target_timerange, segment.source_timerange]) if (range) {
        range.start = gridTime(range.start); range.duration = gridTime(range.duration);
      }
      for (const group of segment.common_keyframes || []) for (const key of group.keyframe_list || []) key.time_offset = gridTime(key.time_offset);
      if (['effect', 'audio'].includes(track.type) && (segment.raw_segment_id === '' || segment.raw_segment_id === track.id)) delete segment.raw_segment_id;
      if (track.type === 'audio' && isDeepStrictEqual(segment.clip, { alpha: 1, rotation: 0, scale: { x: 1, y: 1 }, transform: { x: 0, y: 0 }, flip: { horizontal: false, vertical: false } })) segment.clip = null;
      const refs = (segment.extra_material_refs || []).filter(id => !removed.has(id));
      const companions = new Set(['canvases', 'material_colors', ...Object.keys(inert)]);
      const unordered = new Set(Object.entries(draft.materials || {}).filter(([key]) => companions.has(key))
        .map(([, list]) => list.filter(item => refs.includes(item.id))).filter(list => list.length === 1).flatMap(list => list.map(item => item.id)));
      // Native save reorders singleton companion categories. Effect/mask/animation
      // chains can be order-sensitive and must retain their authored sequence.
      segment.extra_material_refs = [...refs.filter(id => unordered.has(id)).sort(), ...refs.filter(id => !unordered.has(id))];
      if (['text', 'effect'].includes(track.type) && (segment.source_timerange == null || segment.source_timerange.start === 0
        && segment.source_timerange.duration === segment.target_timerange?.duration)) delete segment.source_timerange;
      // Z-order is compared separately before dropping its numeric encoding.
      delete segment.render_index;
      if (segment.track_render_index === 0 || segment.track_render_index === index) delete segment.track_render_index;
    }
  }
  return draft;
}
