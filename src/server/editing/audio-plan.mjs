const number = { type: 'number' }, text = { type: 'string' };
const object = properties => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });
export const audioPlanSchema = object({
  decision: { type: 'string', enum: ['preserve', 'augment'] }, rationale: text,
  assets: { type: 'array', items: object({ id: text, duration: number, seed: { type: 'integer' },
    layers: { type: 'array', items: object({ wave: { type: 'string', enum: ['sine', 'noise'] }, start: number, duration: number,
      frequency: number, endFrequency: number, gain: number, attack: number, release: number, pan: number }) } }) },
  clips: { type: 'array', items: object({ assetId: text, role: { type: 'string', enum: ['music', 'sfx'] }, reason: text,
    start: number, duration: number, sourceStart: number, volume: number,
    keyframes: { type: 'array', items: object({ property: { type: 'string', enum: ['volume'] }, time: number, value: number,
      easing: { type: 'string', enum: ['linear', 'ease-in', 'ease-out', 'ease-in-out', 'hold'] } }) } }) },
});
function keys(value, expected, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !expected.includes(key)) || expected.some(key => !Object.hasOwn(value, key))) throw new Error(`Invalid ${label} fields. Expected: ${expected.join(', ')}.`);
}
function range(value, min, max, label) { if (!Number.isFinite(value) || value < min || value > max) throw new Error(`Invalid ${label}: expected ${min}..${max}.`); }
export function validateAudioPlan(audio, duration) {
  keys(audio, ['decision', 'rationale', 'assets', 'clips'], 'audio plan');
  if (!['preserve', 'augment'].includes(audio.decision) || typeof audio.rationale !== 'string' || !audio.rationale.trim() || audio.rationale.length > 1500) throw new Error('Explain the audio decision.');
  if (!Array.isArray(audio.assets) || audio.assets.length > 12 || !Array.isArray(audio.clips) || audio.clips.length > 64) throw new Error('Audio composition exceeds its budget.');
  if (audio.decision === 'preserve' && (audio.assets.length || audio.clips.length)) throw new Error('Preserve audio requires empty assets and clips.');
  if (audio.decision === 'augment' && !audio.clips.length) throw new Error('An augmented audio plan needs actual clips.');
  const ids = new Map(); let synthesisSeconds = 0, layerSeconds = 0;
  for (const asset of audio.assets) {
    keys(asset, ['id', 'duration', 'seed', 'layers'], 'audio asset');
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(asset.id) || ids.has(asset.id)) throw new Error('Audio asset IDs must be unique safe names.');
    range(asset.duration, 0.02, Math.min(60, duration), 'audio asset duration'); range(asset.seed, 1, 2147483647, 'audio seed');
    if (!Number.isInteger(asset.seed) || !Array.isArray(asset.layers) || !asset.layers.length || asset.layers.length > 256) throw new Error('Invalid synthesis layers.');
    for (const layer of asset.layers) {
      keys(layer, ['wave', 'start', 'duration', 'frequency', 'endFrequency', 'gain', 'attack', 'release', 'pan'], 'synthesis layer');
      if (!['sine', 'noise'].includes(layer.wave)) throw new Error('Unsupported local oscillator.');
      range(layer.start, 0, asset.duration, 'oscillator start'); range(layer.duration, 0.005, asset.duration, 'oscillator duration');
      if (layer.start + layer.duration > asset.duration + 0.000002) throw new Error('Oscillator exceeds audio asset.');
      range(layer.frequency, 20, 16000, 'frequency'); range(layer.endFrequency, 20, 16000, 'end frequency');
      range(layer.gain, 0.001, 0.8, 'oscillator gain'); range(layer.pan, -1, 1, 'pan');
      range(layer.attack, 0.002, layer.duration, 'attack'); range(layer.release, 0.002, layer.duration, 'release');
      if (layer.attack + layer.release > layer.duration + 0.000002) throw new Error('Attack and release exceed the layer duration.');
      layerSeconds += layer.duration;
    }
    ids.set(asset.id, asset); synthesisSeconds += asset.duration;
  }
  if (synthesisSeconds > 180 || layerSeconds > 900) throw new Error('Local synthesis exceeds the per-job computation budget.');
  const used = new Set();
  for (const clip of audio.clips) {
    keys(clip, ['assetId', 'role', 'reason', 'start', 'duration', 'sourceStart', 'volume', 'keyframes'], 'audio clip');
    const asset = ids.get(clip.assetId); used.add(clip.assetId);
    if (!asset || !['music', 'sfx'].includes(clip.role) || typeof clip.reason !== 'string' || !clip.reason.trim() || clip.reason.length > 1000) throw new Error('Audio clips need a generated asset and editorial reason.');
    range(clip.start, 0, duration, 'audio start'); range(clip.duration, 0.01, duration, 'audio duration');
    range(clip.sourceStart, 0, asset.duration, 'audio source start'); range(clip.volume, 0, 1, 'audio volume');
    if (clip.start + clip.duration > duration + 0.000002 || clip.sourceStart + clip.duration > asset.duration + 0.000002) throw new Error('Audio clip exceeds source or target interval.');
    if (!Array.isArray(clip.keyframes) || clip.keyframes.length > 200) throw new Error('Too many volume keys.');
    const times = new Set();
    for (const frame of clip.keyframes) {
      keys(frame, ['property', 'time', 'value', 'easing'], 'volume keyframe');
      if (frame.property !== 'volume' || !['linear', 'ease-in', 'ease-out', 'ease-in-out', 'hold'].includes(frame.easing)) throw new Error('Audio supports only volume keyframes.');
      range(frame.time, 0, clip.duration, 'volume time'); range(frame.value, 0, 1, 'volume keyframe');
      const time = Math.round(frame.time * 1e6); if (times.has(time)) throw new Error('Duplicate volume keyframe.'); times.add(time);
    }
  }
  if ([...ids.keys()].some(id => !used.has(id))) throw new Error('Do not synthesize unused audio assets.');
  return audio;
}
