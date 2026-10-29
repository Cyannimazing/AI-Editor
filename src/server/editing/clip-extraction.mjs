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

/** Controller-owned working media; original draft/media are never written.
 * @param {{ source: string, output: string, job: string,
 * segment: {target_timerange: {start: number, duration: number}, source_timerange?: {start?: number, duration?: number}, speed?: number, reverse?: boolean},
 * mapping?: Record<string, unknown>, companionSpeed?: number, fps?: number, signal?: AbortSignal, onLog?: (line: string) => void }} options
 */
export async function extractTimelineClip({ source, output, job, segment, mapping = undefined, companionSpeed = undefined, fps = 30, signal, onLog = (/** @type {string} */ line) => { void line; } }) {
  const targetSeconds = segment.target_timerange.duration / 1e6;
  const declaredSpeed = segment.speed ?? companionSpeed ?? 1;
  const serializedSourceSeconds = segment.source_timerange?.duration / 1e6;
  let sourceSeconds = segment.source_timerange?.duration == null ? targetSeconds * declaredSpeed : serializedSourceSeconds;
  const sourceStart = (segment.source_timerange?.start ?? 0) / 1e6;
  let speed = sourceSeconds / targetSeconds;
  if (!Number.isFinite(speed) || speed <= 0 || !Number.isFinite(targetSeconds) || targetSeconds < 0.1
    || !Number.isFinite(sourceStart) || sourceStart < 0 || !Number.isFinite(fps) || fps < 1 || fps > 120) throw new Error('The selected clip has invalid timing or project frame rate.');
  if (resolve(source) === resolve(output) || resolve(output) !== resolve(job, 'raw.mp4')) throw new Error('Clip preparation requires a separate job-owned raw.mp4.');
  const original = await probeClipMedia(source, signal);
  const numberOrNull = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
  const report = { version: 1, stage: 'clip_extraction', status: 'preparing',
    timeline: { targetSeconds, sourceSeconds, sourceStart, speed, reverse: Boolean(segment.reverse), fps },
    timing: { sourceDurationBasis: segment.source_timerange?.duration == null ? 'declared_constant_speed' : 'source_timerange',
      serializedSourceRange: segment.source_timerange ? { start: numberOrNull(segment.source_timerange.start), duration: numberOrNull(segment.source_timerange.duration) } : null,
      serializedTargetRange: { start: numberOrNull(segment.target_timerange.start), duration: numberOrNull(segment.target_timerange.duration) },
      declaredSpeed: numberOrNull(segment.speed), companionSpeed: numberOrNull(companionSpeed) }, ...(mapping ? { mapping } : {}), original };
  const save = () => writeFile(join(job, 'clip-extraction-report.json'), JSON.stringify(report, null, 2));
  const failure = (message, code) => Object.assign(new Error(message), {
    diagnostic: { version: 1, stage: 'clip_extraction', code, details: report },
  });
  await save();
  const sourceVideo = original.streams?.find(stream => stream.codec_type === 'video');
  const containerDuration = Number(original.format?.duration), videoDuration = Number(sourceVideo?.duration);
  const streamOffset = Math.max(0, Number(sourceVideo?.start_time || 0) - Number(original.format?.start_time || 0));
  const availableSeconds = Number.isFinite(videoDuration) && videoDuration > 0 ? videoDuration + streamOffset : containerDuration;
  const sourceTolerance = 1 / fps + 0.025;
  const sourceRangeUnretimed = Math.abs(serializedSourceSeconds - targetSeconds) <= 0.000002;
  // Only explicit non-unit native speed can evidence an unretimed default
  // source range. Never invent playback speed from the available file length.
  if (sourceStart + sourceSeconds > availableSeconds + sourceTolerance && sourceRangeUnretimed
    && Number.isFinite(declaredSpeed) && declaredSpeed > 0 && declaredSpeed !== 1
    && sourceStart + targetSeconds * declaredSpeed <= availableSeconds + sourceTolerance) {
    sourceSeconds = targetSeconds * declaredSpeed; speed = declaredSpeed;
    Object.assign(report.timeline, { sourceSeconds, speed }); report.timing.sourceDurationBasis = 'declared_constant_speed';
    onLog(`Using the clip's declared ${declaredSpeed}× playback speed to interpret its unretimed source range. Original timeline values remain unchanged.`);
  }
  report.bounds = { requestedSourceEnd: sourceStart + sourceSeconds, availableSeconds,
    deficitSeconds: Math.max(0, sourceStart + sourceSeconds - availableSeconds), toleranceSeconds: sourceTolerance };
  const stop = async (code, message) => { report.status = code.toLowerCase(); await save(); throw failure(message, code); };
  if (!Number.isFinite(declaredSpeed) || declaredSpeed <= 0 || companionSpeed != null && (!Number.isFinite(companionSpeed) || companionSpeed <= 0
    // The pinned CLI leaves a neutral 1x companion when retiming a segment.
    || segment.speed != null && companionSpeed !== 1 && Math.abs((declaredSpeed - companionSpeed) * targetSeconds) > sourceTolerance)) {
    await stop('CLIP_SPEED_CONFLICT', 'The selected clip has contradictory native playback speeds. Download diagnostics for the serialized timing.');
  }
  if (Number.isFinite(availableSeconds) && availableSeconds > 0 && report.bounds.deficitSeconds > sourceTolerance) {
    await stop('SOURCE_INTERVAL_EXCEEDS_MEDIA', `The selected timeline requests source interval ${sourceStart.toFixed(6)}–${(sourceStart + sourceSeconds).toFixed(6)}s, but the linked video contains ${availableSeconds.toFixed(6)}s. The app has not extended the video. Download diagnostics to trace the selected timeline and source.`);
  }
  if ((segment.speed != null || companionSpeed != null) && Math.abs(sourceSeconds - targetSeconds * declaredSpeed) > sourceTolerance) {
    await stop('CLIP_SPEED_CONFLICT', 'The selected clip\'s source range and native playback speed disagree. Download diagnostics for the serialized timing.');
  }
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
