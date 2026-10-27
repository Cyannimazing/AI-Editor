import { realpath, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';
import { runCancellableProcess } from '../../lib/cancellable-process';
import { mediaTool } from '../platform/runtime.mjs';

/** Local measurements only. This does not transcribe or establish semantic matching. */
export async function measureJobAudio(job: string, sources: { name: string; path: string; hasAudio: boolean }[], signal?: AbortSignal) {
  const root = await realpath(job), evidence = [];
  for (const source of sources) {
    if (!source.hasAudio) { evidence.push({ name: source.name, streamPresent: false }); continue; }
    const file = await realpath(source.path), offset = relative(root, file);
    if (offset === '..' || offset.startsWith('../') || offset.startsWith('..\\') || isAbsolute(offset)) throw new Error('Audio evidence must stay inside the job.');
    let output = '';
    await runCancellableProcess(mediaTool('ffmpeg'), ['-hide_banner', '-i', file, '-map', '0:a:0', '-vn', '-t', '600',
      '-af', 'silencedetect=noise=-45dB:d=0.15,loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json', '-f', 'null', '-'],
    { cwd: root, signal, timeoutMs: 60000, onLine: line => { output = (output + '\n' + line).slice(-100000); } });
    const json = /\{\s*"input_i"[\s\S]*?\}/.exec(output)?.[0];
    if (!json) throw new Error('FFmpeg did not return loudness measurements.');
    const result = JSON.parse(json);
    const numeric = (value: string) => Number.isFinite(Number(value)) ? Number(value) : null;
    const silence = [...output.matchAll(/silence_(start|end):\s*([\d.]+)/g)].map(match => ({ boundary: match[1], seconds: Number(match[2]) }));
    evidence.push({ name: source.name, streamPresent: true, integratedLufs: numeric(result.input_i), truePeakDbtp: numeric(result.input_tp),
      loudnessRangeLu: numeric(result.input_lra), silence: silence.slice(0, 100), analysisLimitSeconds: 600,
      speechTranscribed: false, semanticMatchVerified: false });
  }
  const report = { tool: 'Local FFmpeg loudnorm measurement and silence detection', sources: evidence,
    limitations: ['Measurements do not establish wording, musical beats, sound identity or perceptual matching.', 'No source audio was modified.'] };
  await writeFile(join(root, 'audio-evidence.json'), JSON.stringify(report));
  return report;
}
