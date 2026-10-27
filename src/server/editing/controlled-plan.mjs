import { pixelsToNativeTextSize } from './native-text.mjs';
import { audioPlanSchema, validateAudioPlan } from './audio-plan.mjs';
const number = { type: 'number' }, text = { type: 'string' };
const object = properties => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });
const keyframe = object({ property: { type: 'string', enum: ['scale', 'x', 'y', 'rotation', 'opacity', 'volume', 'brightness', 'contrast', 'saturation'] }, time: number, value: number,
  easing: { type: 'string', enum: ['linear', 'ease-in', 'ease-out', 'ease-in-out', 'hold'] } });
const pose = { scale: number, x: number, y: number, rotation: number, opacity: number };
export const controlledPlanSchema = object({
  version: { type: 'integer', enum: [2] }, summary: text,
  source: object({ ...pose, volume: number, keyframes: { type: 'array', items: keyframe } }),
  texts: { type: 'array', items: object({ text, start: number, duration: number, fontSizePx: number, color: text,
    ...pose, keyframes: { type: 'array', items: keyframe } }) },
  techniques: { type: 'array', items: object({ id: text, name: text, start: number, end: number, evidence: text, confidence: number }) },
  unsupported: { type: 'array', items: text },
});
export const expandedPlanSchema = object({ ...controlledPlanSchema.properties,
  version: { type: 'integer', enum: [3] },
  assets: { type: 'array', items: object({ id: text, kind: { type: 'string', enum: ['svg', 'source-frame'] }, frameTime: number, svg: text, width: { type: 'integer' }, height: { type: 'integer' } }) },
  overlays: { type: 'array', items: object({ assetId: text, start: number, duration: number, sourceStart: number, ...pose, volume: number, blendMode: text, keyframes: { type: 'array', items: keyframe } }) },
  effects: { type: 'array', items: object({ slug: text, target: text, start: number, duration: number, intensity: number, params: { type: 'array', items: number } }) },
  resourceQueries: { type: 'array', items: object({ kind: { type: 'string', enum: ['video_effect', 'face_effect', 'filter', 'transition', 'font', 'text_effect', 'text_template', 'sound_effect', 'music'] }, query: text }) },
});
export const professionalPlanSchema = object({ ...expandedPlanSchema.properties,
  version: { type: 'integer', enum: [4] },
  texts: { type: 'array', items: object({ ...controlledPlanSchema.properties.texts.items.properties,
    bold: { type: 'boolean' }, italic: { type: 'boolean' }, font: text,
  }) },
  techniques: { type: 'array', items: object({ ...controlledPlanSchema.properties.techniques.items.properties,
    components: { type: 'array', items: text },
    expectedBehavior: text,
    checks: { type: 'array', items: text },
  }) },
});
export const soundDesignPlanSchema = object({ ...professionalPlanSchema.properties,
  version: { type: 'integer', enum: [5] }, audio: audioPlanSchema,
});

function finite(value, min, max, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error(`Invalid ${label}.`);
}
function exactKeys(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid ${label}: expected an object.`);
  const missing = keys.filter(key => !Object.hasOwn(value, key)), extra = Object.keys(value).filter(key => !keys.includes(key));
  if (missing.length || extra.length) throw new Error(`Invalid ${label} fields.${missing.length ? ` Missing: ${missing.join(', ')}.` : ''}${extra.length ? ` Unexpected: ${extra.map(key => key.slice(0, 60)).join(', ')}.` : ''}`);
}
function validatePose(value, duration, withVolume) {
  finite(value.scale, 0.05, 10, 'scale'); finite(value.x, -2, 2, 'x'); finite(value.y, -2, 2, 'y');
  finite(value.rotation, -3600, 3600, 'rotation'); finite(value.opacity, 0, 1, 'opacity');
  if (withVolume) finite(value.volume, 0, 2, 'volume');
  if (!Array.isArray(value.keyframes) || value.keyframes.length > 1000) throw new Error('Too many motion keyframes.');
  const seen = new Set();
  for (const frame of value.keyframes) {
    exactKeys(frame, ['property', 'time', 'value', 'easing'], 'keyframe');
    if (!['scale', 'x', 'y', 'rotation', 'opacity', ...(withVolume ? ['volume', 'brightness', 'contrast', 'saturation'] : [])].includes(frame.property) || !['linear', 'ease-in', 'ease-out', 'ease-in-out', 'hold'].includes(frame.easing)) throw new Error('Unsupported keyframe.');
    finite(frame.time, 0, duration, 'keyframe time');
    const bounds = { scale: [0.05, 10], x: [-2, 2], y: [-2, 2], rotation: [-3600, 3600], opacity: [0, 1], volume: [0, 2], brightness: [-1, 1], contrast: [-1, 1], saturation: [-1, 1] }[frame.property];
    finite(frame.value, ...bounds, 'keyframe value');
    const key = `${frame.property}:${Math.round(frame.time * 1e6)}`;
    if (seen.has(key)) throw new Error('Duplicate keyframe timing.'); seen.add(key);
  }
}
export function validateControlledPlan(plan, duration) {
  finite(duration, 0.1, 3600, 'source duration');
  exactKeys(plan, ['version', 'summary', 'source', 'texts', 'techniques', 'unsupported', ...(plan.version >= 3 ? ['assets', 'overlays', 'effects', 'resourceQueries'] : []), ...(plan.version >= 5 ? ['audio'] : [])], 'plan');
  if (![2, 3, 4, 5].includes(plan.version) || typeof plan.summary !== 'string' || plan.summary.length > 4000) throw new Error('Unsupported editing plan.');
  if (plan.version >= 5) validateAudioPlan(plan.audio, duration);
  exactKeys(plan.source, ['scale', 'x', 'y', 'rotation', 'opacity', 'volume', 'keyframes'], 'source'); validatePose(plan.source, duration, true);
  if (!Array.isArray(plan.texts) || plan.texts.length > 200) throw new Error('Too many text layers.');
  let characters = 0;
  for (const item of plan.texts) {
    exactKeys(item, ['text', 'start', 'duration', 'fontSizePx', 'color', 'scale', 'x', 'y', 'rotation', 'opacity', 'keyframes', ...['bold', 'italic', 'font'].filter(key => Object.hasOwn(item, key))], 'text');
    if (item.font !== undefined && (typeof item.font !== 'string' || !/^[a-z][a-z0-9-]{0,79}$/.test(item.font))) throw new Error('Invalid local text font identifier.');
    for (const key of ['bold', 'italic']) if (Object.hasOwn(item, key) && typeof item[key] !== 'boolean') throw new Error('Invalid native text styling.');
    if (typeof item.text !== 'string' || !item.text.trim() || item.text.length > 2000 || !/^#[0-9a-f]{6}$/i.test(item.color)) throw new Error('Invalid editable text.');
    characters += item.text.length;
    finite(item.start, 0, duration, 'text start'); finite(item.duration, 0.01, duration, 'text duration');
    if (item.start + item.duration > duration + 0.000002) throw new Error('Text extends outside the selected clip.');
    finite(item.fontSizePx, 8, 400, 'font size'); validatePose(item, item.duration, false);
  }
  if (characters > 20000 || !Array.isArray(plan.techniques) || !plan.techniques.length || plan.techniques.length > 100 || !Array.isArray(plan.unsupported) || plan.unsupported.length > 100 || plan.unsupported.some(item => typeof item !== 'string' || item.length > 2000)) throw new Error('Editing plan exceeds its limits.');
  const techniqueIds = new Set();
  for (const item of plan.techniques) {
    exactKeys(item, ['id', 'name', 'start', 'end', 'evidence', 'confidence', ...(plan.version >= 4 ? ['components', 'expectedBehavior', 'checks'] : [])], 'technique');
    if (![item.id, item.name, item.evidence].every(value => typeof value === 'string' && value.length > 0 && value.length < 4000)) throw new Error('Invalid technique evidence.');
    if (techniqueIds.has(item.id)) throw new Error('Duplicate technique ID.'); techniqueIds.add(item.id);
    finite(item.start, 0, duration, 'technique start'); finite(item.end, item.start, duration, 'technique end'); finite(item.confidence, 0, 1, 'confidence');
    if (plan.version >= 4) {
      if (!Array.isArray(item.components) || !item.components.length || item.components.length > 100 || new Set(item.components).size !== item.components.length ||
        typeof item.expectedBehavior !== 'string' || !item.expectedBehavior.trim() || item.expectedBehavior.length > 2000 ||
        !Array.isArray(item.checks) || !item.checks.length || item.checks.length > 12 || item.checks.some(check => typeof check !== 'string' || !check.trim() || check.length > 1000)) throw new Error('Every technique requires components, expected behavior and observable checks.');
      for (const ref of item.components) {
        const match = /^(text|overlay|effect|audio)-(\d+)$/.exec(ref);
        const component = ref === 'source' ? { start: 0, duration } : match?.[1] === 'audio' ? plan.audio?.clips[Number(match[2])]
          : match ? plan[({ text: 'texts', overlay: 'overlays', effect: 'effects' })[match[1]]]?.[Number(match[2])] : null;
        if (!component || component.start >= item.end || component.start + component.duration <= item.start) throw new Error(`Technique ${item.id} references a missing or non-overlapping component: ${ref}`);
      }
    }
  }
  if (plan.version >= 3) {
    if (!Array.isArray(plan.assets) || plan.assets.length > 24 || !Array.isArray(plan.overlays) || plan.overlays.length > 64 || !Array.isArray(plan.effects) || plan.effects.length > 64 || !Array.isArray(plan.resourceQueries) || plan.resourceQueries.length > 3) throw new Error('Expanded build exceeds its limits.');
    for (const item of plan.overlays) {
      exactKeys(item, ['assetId', 'start', 'duration', 'sourceStart', 'scale', 'x', 'y', 'rotation', 'opacity', 'volume', 'blendMode', 'keyframes'], 'overlay');
      if (typeof item.assetId !== 'string' || !['normal', 'multiply', 'screen', 'overlay', 'soft-light', 'hard-light', 'color-dodge', 'color-burn', 'darken', 'lighten', 'difference', 'exclusion'].includes(item.blendMode)) throw new Error('Invalid overlay source or blend mode.');
      finite(item.start, 0, duration, 'overlay start'); finite(item.duration, 0.01, duration, 'overlay duration'); finite(item.sourceStart, 0, duration, 'overlay source start');
      if (item.start + item.duration > duration + 0.000002 || (item.assetId === 'source' && item.sourceStart + item.duration > duration + 0.000002)) throw new Error('Overlay exceeds its source or target interval.');
      validatePose(item, item.duration, true);
    }
    for (const item of plan.effects) {
      exactKeys(item, ['slug', 'start', 'duration', 'intensity', 'params', ...(Object.hasOwn(item, 'target') ? ['target'] : [])], 'effect');
      if (item.target !== undefined && !/^(source|overlay-\d+|text-\d+)$/.test(item.target)) throw new Error('Invalid native effect target.');
      if (typeof item.slug !== 'string' || item.slug.length > 100 || !Array.isArray(item.params) || item.params.length > 20) throw new Error('Invalid native effect.');
      finite(item.start, 0, duration, 'effect start'); finite(item.duration, 0.01, duration, 'effect duration'); finite(item.intensity, 0, 1, 'effect intensity');
      if (item.start + item.duration > duration + 0.000002) throw new Error('Effect exceeds the selected interval.');
      item.params.forEach(value => finite(value, 0, 100, 'effect parameter'));
    }
    for (const item of plan.resourceQueries) {
      exactKeys(item, ['kind', 'query'], 'resource query');
      if (typeof item.query !== 'string' || !item.query.trim() || item.query.length > 500 || !expandedPlanSchema.properties.resourceQueries.items.properties.kind.enum.includes(item.kind)) throw new Error('Invalid official material query.');
    }
  }
  return structuredClone(plan);
}

export function compileControlledSpec(plan, input, assets = new Map(), audioAssets = new Map()) {
  validateControlledPlan(plan, input.duration);
  const operations = [];
  function motion(target, value) {
    for (const frame of value.keyframes) for (const property of frame.property === 'scale' ? ['scale_x', 'scale_y'] : [({ x: 'position_x', y: 'position_y', opacity: 'alpha' })[frame.property] || frame.property])
      operations.push({ op: 'keyframe', target, property, time: frame.time, value: frame.value, easing: frame.easing });
  }
  motion('source', plan.source);
  const tracks = [{ type: 'video', name: 'AI source', items: [{ ref: 'source', path: input.source, start: 0, duration: input.duration, ...Object.fromEntries(['scale', 'x', 'y', 'rotation', 'volume'].map(key => [key, plan.source[key]])), opacity: plan.source.opacity }] }];
  for (const [index, item] of (plan.overlays || []).entries()) {
    const path = item.assetId === 'source' ? input.source : assets.get(item.assetId);
    if (!path) throw new Error(`Missing generated asset: ${item.assetId}`);
    motion(`overlay-${index}`, item);
    tracks.push({ type: 'video', name: `AI overlay ${index + 1}`, items: [{ ref: `overlay-${index}`, path, type: item.assetId === 'source' ? 'video' : 'photo',
      start: item.start, duration: item.duration, sourceStart: item.sourceStart, scale: item.scale, x: item.x, y: item.y, rotation: item.rotation, opacity: item.opacity, volume: 0 }] });
  }
  if (plan.texts.length) tracks.push({ type: 'text', name: 'AI editable text', items: plan.texts.map((item, index) => {
    motion(`text-${index}`, item);
    return { ref: `text-${index}`, text: item.text, start: item.start, duration: item.duration, fontSize: pixelsToNativeTextSize(item.fontSizePx, input.width, input.height),
      color: item.color, scale: item.scale, x: item.x, y: item.y, rotation: item.rotation, opacity: item.opacity };
  }) });
  for (const [index, item] of (plan.audio?.clips || []).entries()) {
    const path = audioAssets.get(item.assetId); if (!path) throw new Error(`Missing generated audio: ${item.assetId}`);
    motion(`audio-${index}`, item);
    tracks.push({ type: 'audio', name: `AI ${item.role} ${index + 1}`, items: [{ ref: `audio-${index}`, path,
      start: item.start, duration: item.duration, sourceStart: item.sourceStart, volume: item.volume }] });
  }
  return { name: 'AI Editor candidate', width: input.width, height: input.height, fps: input.fps || 30, tracks, operations };
}
