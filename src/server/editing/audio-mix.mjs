import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { lstat, realpath, writeFile } from 'node:fs/promises';
import { isAbsolute, relative, join } from 'node:path';
import { mediaTool } from '../platform/runtime.mjs';
import { nativeCurveValue } from './motion-preview.mjs';
import { audioRate, encodeWav } from './audio-synthesis.mjs';

const run = promisify(execFile);
const inside = (root, path) => { const p = relative(root, path); return p !== '..' && !p.startsWith('../') && !p.startsWith('..\\') && !isAbsolute(p); };

export function mixNativeTrack(mix, decoded, segment, { start, duration, timelineStart }) {
  const frames = segment.common_keyframes?.find(curve => curve.property_type === 'KFTypeVolume')?.keyframe_list;
  const offset = Math.round((start - timelineStart) * audioRate), count = Math.min(decoded.length / 2, Math.round(duration * audioRate));
  const localStart = start - segment.target_timerange.start / 1e6;
  let peak = 0, square = 0;
  // Evaluate the saved curve every sample: native holds and sharp ducks must not
  // be smeared across a video frame. Constant gains avoid curve work entirely.
  for (let i = 0; i < count; i++) {
    const gain = nativeCurveValue(frames, (localStart + i / audioRate) * 1e6, segment.volume ?? 1);
    if (!Number.isFinite(gain) || gain < 0 || gain > 16) throw new Error('Invalid native audio gain.');
    for (let channel = 0; channel < 2; channel++) {
      const value = decoded[i * 2 + channel] * gain, at = (offset + i) * 2 + channel;
      if (!Number.isFinite(value)) throw new Error('Invalid decoded audio sample.');
      if (at >= 0 && at < mix.length) mix[at] += value;
      peak = Math.max(peak, Math.abs(value)); square += value * value;
    }
  }
  return { peak, rms: Math.sqrt(square / Math.max(1, count * 2)), volumeKeys: frames?.length || 0 };
}

/** Read actual saved native audio controls; this is a local preview, not proof
 * that CapCut played it. Inputs come from the candidate and original snapshot. */
export async function renderNativeAudio({ draft, original, job, candidate, start = 0, duration, refs = {} }) {
  if (!(duration > 0 && duration <= 600 && start >= 0)) throw new Error('Audio preview exceeds its duration budget.');
  const allowed = new Set(Object.values(original.materials || {}).flatMap(items => Array.isArray(items) ? items.map(item => item.path).filter(Boolean) : []));
  const roots = await Promise.all([job, candidate].map(path => realpath(path)));
  const mix = new Float32Array(Math.round(duration * audioRate) * 2), tracks = [], metadata = new Map();
  const end = start + duration;
  for (const track of draft.tracks) {
    if (!['video', 'audio'].includes(track.type)) continue;
    for (const segment of track.segments) {
      const begin = segment.target_timerange.start / 1e6, length = segment.target_timerange.duration / 1e6;
      const from = Math.max(start, begin), to = Math.min(end, begin + length);
      if (to <= from) continue;
      const material = (draft.materials[track.type === 'audio' ? 'audios' : 'videos'] || []).find(item => item.id === segment.material_id);
      if (!material || material.type === 'photo') continue;
      const info = await lstat(material.path);
      const path = await realpath(material.path);
      if (!isAbsolute(material.path) || !info.isFile() || info.isSymbolicLink() || !roots.some(root => inside(root, path)) && !allowed.has(material.path)) throw new Error('Unknown or linked audio preview dependency.');
      if (!metadata.has(path)) {
        const { stdout } = await run(mediaTool('ffprobe'), ['-v', 'error', '-protocol_whitelist', 'file,pipe', '-show_entries', 'stream=codec_type', '-of', 'json', path], { timeout: 15000, windowsHide: true });
        metadata.set(path, JSON.parse(stdout).streams?.some(stream => stream.codec_type === 'audio'));
      }
      if (!metadata.get(path)) continue;
      if (tracks.length >= 64) throw new Error('Audio preview exceeds its track budget.');
      const speed = segment.speed ?? 1;
      if (!(speed >= 0.125 && speed <= 8)) throw new Error('Unsupported audio speed; cannot verify this mix.');
      const filters = []; let remaining = speed;
      while (remaining < 0.5) { filters.push('atempo=0.5'); remaining /= 0.5; }
      while (remaining > 2) { filters.push('atempo=2'); remaining /= 2; }
      if (remaining !== 1) filters.push(`atempo=${remaining}`);
      const sourceStart = (segment.source_timerange?.start || 0) / 1e6 + (from - begin) * speed;
      if (!Number.isFinite(sourceStart) || sourceStart < 0) throw new Error('Invalid audio source timing.');
      const { stdout } = await run(mediaTool('ffmpeg'), ['-v', 'error', '-protocol_whitelist', 'file,pipe', '-ss', String(sourceStart), '-i', path,
        '-map', '0:a:0', '-vn', ...(filters.length ? ['-af', filters.join(',')] : []), '-t', String(to - from), '-ac', '2', '-ar', String(audioRate), '-f', 'f32le', 'pipe:1'],
      { timeout: 60000, windowsHide: true, encoding: 'buffer', maxBuffer: Math.ceil((to - from + 1) * audioRate * 8) });
      const samples = new Float32Array(stdout.length / 4);
      for (let i = 0; i < samples.length; i++) samples[i] = stdout.readFloatLE(i * 4);
      const levels = mixNativeTrack(mix, samples, segment, { start: from, duration: to - from, timelineStart: start });
      tracks.push({ id: segment.id, component: Object.keys(refs).find(ref => refs[ref] === segment.id) || 'existing-audio',
        start: from - start, duration: to - from, decodedSeconds: samples.length / 2 / audioRate, ...levels });
    }
  }
  let peak = 0, clippedSamples = 0, square = 0;
  for (const value of mix) { peak = Math.max(peak, Math.abs(value)); square += value * value; if (Math.abs(value) > 1) clippedSamples++; }
  const report = { version: 1, start, duration, sampleRate: audioRate, channels: 2, tracks, peak, clippedSamples,
    rms: Math.sqrt(square / mix.length), nativeVolumeCurves: true, nativeVerified: false,
    limitations: ['Signal and native gain checks do not establish speech content, musical taste or a listening comparison.', 'Native audio effects and platform-specific processing require CapCut playback.'] };
  const path = join(job, 'preview-audio.wav');
  await writeFile(path, encodeWav(mix));
  await writeFile(join(job, 'audio-mix-report.json'), JSON.stringify(report));
  return { path, report };
}

export function audioMixDefects(report) {
  const added = report.tracks.filter(track => track.component.startsWith('audio-'));
  const defects = [];
  if (added.length && report.clippedSamples) defects.push({ component: 'audio', timeSeconds: 0,
    expected: 'A clean mix that preserves source audio without clipping.', observed: `The new mix clips ${report.clippedSamples} samples (peak ${report.peak.toFixed(3)}). Lower or duck the added tracks.`, evidence: 'audio-mix-report.json' });
  for (const track of added) if (track.peak < 0.0001 || track.decodedSeconds + 0.025 < track.duration) defects.push({ component: track.component, timeSeconds: track.start,
    expected: 'The planned sound is audible for its intended interval.', observed: track.peak < 0.0001 ? 'The constructed audio is silent.' : 'The audio ends before its planned duration.', evidence: 'audio-mix-report.json' });
  return defects;
}

export function includeAudioDefects(findings, report, techniques) {
  const defects = audioMixDefects(report);
  if (!defects.length) return findings;
  return { ...findings, decision: 'revise', summary: 'The audio mix needs correction.', defects: [...defects, ...findings.defects],
    techniques: findings.techniques.map(item => techniques.find(technique => technique.id === item.id)?.components?.some(ref => ref.startsWith('audio-'))
      ? { ...item, status: 'defect' } : item) };
}
