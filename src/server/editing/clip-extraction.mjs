import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { mediaTool } from '../platform/runtime.mjs';

const run = promisify(execFile);
export async function probeClipMedia(path, signal) {
  const { stdout } = await run(mediaTool('ffprobe'), ['-v', 'error', '-show_entries',
    'format=duration,start_time:stream=index,codec_type,codec_name,width,height,duration,start_time,r_frame_rate,avg_frame_rate,time_base,nb_frames,sample_rate,channels', '-of', 'json', path],
  { timeout: 30000, maxBuffer: 1000000, windowsHide: true, signal });
  return JSON.parse(stdout);
}

/** Controller-owned working media; original draft/media are never written. */
export async function extractTimelineClip({ source, output, job, segment, fps = 30, signal, onLog = (/** @type {string} */ line) => { void line; } }) {
  const targetSeconds = segment.target_timerange.duration / 1e6;
  const sourceSeconds = (segment.source_timerange?.duration ?? segment.target_timerange.duration) / 1e6;
  const sourceStart = (segment.source_timerange?.start ?? 0) / 1e6, speed = sourceSeconds / targetSeconds;
  if (!Number.isFinite(speed) || speed <= 0 || !Number.isFinite(targetSeconds) || targetSeconds < 0.1
    || !Number.isFinite(sourceStart) || sourceStart < 0 || !Number.isFinite(fps) || fps < 1 || fps > 120) throw new Error('The selected clip has invalid timing or project frame rate.');
  if (resolve(source) === resolve(output) || resolve(output) !== resolve(job, 'raw.mp4')) throw new Error('Clip preparation requires a separate job-owned raw.mp4.');
  const original = await probeClipMedia(source, signal);
  const report = { version: 1, stage: 'clip_extraction', status: 'preparing',
    timeline: { targetSeconds, sourceSeconds, sourceStart, speed, reverse: Boolean(segment.reverse), fps }, original };
  const save = () => writeFile(join(job, 'clip-extraction-report.json'), JSON.stringify(report, null, 2));
  const failure = (message, code) => Object.assign(new Error(message), {
    diagnostic: { version: 1, stage: 'clip_extraction', code, details: report },
  });
  await save();
  onLog(`Preparing ${targetSeconds.toFixed(6)}s at project rate ${fps} FPS; source interval ${sourceStart.toFixed(6)}–${(sourceStart + sourceSeconds).toFixed(6)}s, playback ${speed.toFixed(6)}×.`);
  const hasAudio = original.streams?.some(stream => stream.codec_type === 'audio');
  const audioFilters = segment.reverse ? ['areverse'] : []; let tempo = speed;
  while (tempo < 0.5) { audioFilters.push('atempo=0.5'); tempo /= 0.5; }
  while (tempo > 2) { audioFilters.push('atempo=2'); tempo /= 2; }
  audioFilters.push(`atempo=${tempo}`);
  try { await run(mediaTool('ffmpeg'), ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(sourceStart), '-t', String(sourceSeconds),
    '-i', source, '-map', '0:v:0', '-map', '0:a?', '-vf', `${segment.reverse ? 'reverse,' : ''}setpts=(PTS-STARTPTS)/${speed}`,
    ...(hasAudio ? ['-af', audioFilters.join(',')] : []), '-r', String(fps), '-fps_mode', 'cfr', '-t', String(targetSeconds),
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', output],
  { timeout: 180000, maxBuffer: 2000000, windowsHide: true, signal }); }
  catch (error) {
    signal?.throwIfAborted(); report.status = 'tool_failed'; report.toolExitCode = error.code;
    await save(); throw failure('Clip preparation failed in FFmpeg. Download diagnostics for the source and timeline timing.', 'CLIP_EXTRACTION_FAILED');
  }
  const prepared = await probeClipMedia(output, signal);
  const video = prepared.streams?.find(stream => stream.codec_type === 'video');
  const containerSeconds = Number(prepared.format?.duration), videoSeconds = Number(video?.duration);
  // MP4 ends at a frame boundary; AAC adds at most a small packet quantum.
  // This allowance cannot excuse a materially missing interval of footage.
  const toleranceSeconds = 1 / fps + 0.025;
  report.prepared = prepared;
  report.measured = { containerSeconds, videoSeconds, deltaSeconds: containerSeconds - targetSeconds, toleranceSeconds };
  if (![containerSeconds, videoSeconds].every(Number.isFinite) || !video?.width || !video?.height
    || Math.abs(containerSeconds - targetSeconds) > toleranceSeconds || Math.abs(videoSeconds - targetSeconds) > toleranceSeconds) {
    report.status = 'duration_mismatch'; await save();
    throw failure(`The extracted clip did not match its timeline duration: expected ${targetSeconds.toFixed(6)}s, prepared ${containerSeconds.toFixed(6)}s (video ${videoSeconds.toFixed(6)}s; tolerance ${toleranceSeconds.toFixed(6)}s at ${fps} FPS). Download diagnostics for the measured source and clip timing.`, 'CLIP_DURATION_MISMATCH');
  }
  report.status = 'ready'; await save();
  onLog(`Clip timing checked: expected ${targetSeconds.toFixed(6)}s, prepared ${containerSeconds.toFixed(6)}s; native timeline timing remains ${targetSeconds.toFixed(6)}s.`);
  return { probe: prepared, original, report };
}
