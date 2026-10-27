import { mkdir, readFile, writeFile, lstat, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, relative, isAbsolute } from 'node:path';
import { validateAudioPlan } from './audio-plan.mjs';

export const audioRate = 48000;
export function encodeWav(samples, sampleRate = audioRate) {
  const output = Buffer.alloc(44 + samples.length * 2);
  output.write('RIFF'); output.writeUInt32LE(output.length - 8, 4); output.write('WAVEfmt ', 8); output.writeUInt32LE(16, 16);
  output.writeUInt16LE(1, 20); output.writeUInt16LE(2, 22); output.writeUInt32LE(sampleRate, 24); output.writeUInt32LE(sampleRate * 4, 28);
  output.writeUInt16LE(4, 32); output.writeUInt16LE(16, 34); output.write('data', 36); output.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) output.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), 44 + i * 2);
  return output;
}

/** Parameterized signal composition, not model-authored executable code. */
export function synthesizeAudio(asset) {
  const rate = audioRate, samples = new Float32Array(Math.round(asset.duration * rate) * 2);
  let seed = asset.seed >>> 0;
  const random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 2147483648 - 1; };
  for (const layer of asset.layers) {
    const count = Math.round(layer.duration * rate), offset = Math.round(layer.start * rate);
    const left = Math.cos((layer.pan + 1) * Math.PI / 4), right = Math.sin((layer.pan + 1) * Math.PI / 4);
    let phase = 0, filtered = 0;
    for (let n = 0; n < count && offset + n < samples.length / 2; n++) {
      const time = n / rate, frequency = layer.frequency * (layer.endFrequency / layer.frequency) ** (time / layer.duration);
      phase += 2 * Math.PI * frequency / rate;
      const envelope = Math.sin(Math.min(1, time / layer.attack, (layer.duration - time) / layer.release) * Math.PI / 2) ** 2;
      if (layer.wave === 'noise') filtered += (1 - Math.exp(-2 * Math.PI * frequency / rate)) * (random() - filtered);
      const sample = (layer.wave === 'sine' ? Math.sin(phase) : filtered) * envelope * layer.gain;
      samples[(offset + n) * 2] += sample * left; samples[(offset + n) * 2 + 1] += sample * right;
    }
  }
  let peak = 0; for (const value of samples) peak = Math.max(peak, Math.abs(value));
  // Only reduce excessive summed oscillators; never amplify a quiet sound.
  const gain = peak > 0.85 ? 0.85 / peak : 1;
  if (gain !== 1) for (let i = 0; i < samples.length; i++) samples[i] *= gain;
  return { wav: encodeWav(samples), peak: peak * gain, normalizationGain: gain };
}

export async function renderAudioAssets(audio, job, duration) {
  if (!audio) return new Map(); validateAudioPlan(audio, duration);
  const directory = join(job, 'generated-audio'); await mkdir(directory, { recursive: true });
  const offset = relative(await realpath(job), await realpath(directory));
  if (isAbsolute(offset) || offset.startsWith('..') || (await lstat(directory)).isSymbolicLink()) throw new Error('Generated audio escapes its job.');
  const assets = new Map();
  for (const asset of audio.assets) {
    const hash = createHash('sha256').update(JSON.stringify({ synthesisVersion: 1, ...asset })).digest('hex');
    const file = join(directory, `${hash}.wav`), source = join(directory, `${hash}.source.json`);
    // Check both paths before any read or write, including an incomplete cache.
    for (const path of [file, source]) {
      const stat = await lstat(path).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
      if (stat && (!stat.isFile() || stat.isSymbolicLink())) throw new Error('Linked or non-file audio cache.');
    }
    let cached = false;
    try {
      const record = JSON.parse(await readFile(source));
      cached = record.sha256 === createHash('sha256').update(await readFile(file)).digest('hex');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (!cached) {
      const result = synthesizeAudio(asset); await writeFile(file, result.wav);
      await writeFile(source, JSON.stringify({ synthesisVersion: 1, asset, sampleRate: audioRate, channels: 2, peak: result.peak,
        normalizationGain: result.normalizationGain, sha256: createHash('sha256').update(result.wav).digest('hex'),
        provenance: 'Original local procedural signal; no downloaded recording or external generation service.' }));
    }
    assets.set(asset.id, file);
  }
  return assets;
}
