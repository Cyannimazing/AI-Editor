import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, realpath, lstat } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';
import { motionPython, motionRuntimeReady } from './motion-runtime.mjs';
import { motionCheckTimes } from './motion-comparison.mjs';
import { coverageDefects, feasibleFraming } from './motion-coverage.mjs';

const inside = (root, file) => { const rel = relative(root, file); return rel !== '..' && !rel.startsWith('..\\') && !rel.startsWith('../') && !isAbsolute(rel); };

/** Same-time correspondence only. An unrelated style reference gets no invented camera motion. */
export async function measureReferenceMotion(job, referenceIndex, sourceIndex, signal) {
  if (!referenceIndex?.frames?.length || !sourceIndex?.frames?.length) return { version: 1, samples: [], reason: 'Video source/reference frame evidence is unavailable.' };
  if (!await motionRuntimeReady()) return { version: 1, samples: [], reason: 'Local frame measurement needs tool setup.' };
  const root = await realpath(job);
  const pairs = [];
  // Bound execution while preserving the opening, ending and distribution over the timeline.
  const indices = referenceIndex.frames.length <= 120 ? referenceIndex.frames.map((_, i) => i)
    : Array.from({ length: 120 }, (_, i) => Math.round(i * (referenceIndex.frames.length - 1) / 119));
  for (const index of indices) {
    const reference = referenceIndex.frames[index];
    if (!Number.isFinite(reference.time) || reference.time < 0) throw new Error('Invalid motion evidence time.');
    const source = sourceIndex.frames.reduce((best, item) => Math.abs(item.time - reference.time) < Math.abs(best.time - reference.time) ? item : best);
    if (Math.abs(source.time - reference.time) > 0.51 / Math.min(sourceIndex.sampleFps, referenceIndex.sampleFps)) continue;
    for (const file of [reference.path, source.path]) {
      const stat = await lstat(file);
      if (!inside(root, file) || !inside(root, await realpath(file)) || !stat.isFile() || stat.isSymbolicLink() || stat.size > 20 * 1024 * 1024) throw new Error('Motion evidence must be regular job-owned frames.');
    }
    pairs.push({ reference: reference.path, source: source.path, time: reference.time, sourceTime: source.time });
  }
  if (!pairs.length) return { version: 1, samples: [], reason: 'Source and reference sampling times do not align.' };
  const request = join(root, 'motion-measure-request.json');
  await writeFile(request, JSON.stringify({ job: root, pairs }));
  const { stdout } = await promisify(execFile)(motionPython(), ['-I', '-B', join(process.cwd(), 'scripts/measure-frame-motion.py'), request],
    { windowsHide: true, timeout: 120000, signal, maxBuffer: 2000000 });
  const result = JSON.parse(stdout);
  if (result.version !== 1 || result.samples?.length !== pairs.length || result.samples.some((sample, i) => sample.time !== pairs[i].time)) throw new Error('Invalid local motion measurement receipt.');
  for (const sample of result.samples) sample.coverageSafeAlternative = feasibleFraming(sample, sourceIndex.width, sourceIndex.height);
  await writeFile(join(root, 'motion-reference.json'), JSON.stringify(result));
  return result;
}

export function motionEvidenceContext(report) {
  return JSON.stringify({ method: report.method, reason: report.reason, limitations: report.limitations,
    rule: 'These are geometric observations, NOT keyframes to copy. x is positive right, y up; full-canvas coordinates include mattes. directlyApplicable=false means that fit exposes picture gaps: solve framing/compositing instead of shrinking footage into empty space. Preserve intentional reference borders, not additional accidental borders. Do not infer a zoom trajectory or a terminal hold from sparse matches. Inspect adjacent frames, subject movement, easing and the complete picture before choosing curves. Unmatched frames give no reliable transform. Native effects still need native evidence.',
    samples: (report.samples || []).map(({ time, status, transform, inliers, inlierRatio, medianResidualPx, reason, sourceBounds, referenceBounds, directlyApplicable, uncoveredReferenceFraction, coverageSafeAlternative }) =>
      ({ time, status, transform, inliers, inlierRatio, medianResidualPx, reason, sourceBounds, referenceBounds, directlyApplicable, uncoveredReferenceFraction, coverageSafeAlternative })) });
}

/** Inspect every sampled output frame, rather than only the eight AI panels. */
export async function auditMotionFrames(job, reference, preview, motion, iteration, signal) {
  if (!reference?.frames?.length || !preview?.frames?.length || !(motion.samples || []).some(sample => sample.status === 'matched'))
    return { defects: [], samples: [], reason: 'No shared-footage reference for deterministic picture coverage.' };
  if (Math.abs(reference.width / reference.height - preview.width / preview.height) > 0.01)
    return { defects: [], samples: [], reason: 'Different output aspect ratios require visual composition review, not a same-canvas coverage verdict.' };
  const root = await realpath(job), pairs = [];
  const frames = reference.frames.length <= 120 ? reference.frames : Array.from({ length: 120 }, (_, i) => reference.frames[Math.round(i * (reference.frames.length - 1) / 119)]);
  for (const frame of frames) {
    const closest = preview.frames.reduce((best, item) => Math.abs(item.time - frame.time) < Math.abs(best.time - frame.time) ? item : best);
    if (Math.abs(closest.time - frame.time) > 0.51 / preview.sampleFps) continue;
    for (const file of [frame.path, closest.path]) {
      const stat = await lstat(file);
      if (!inside(root, file) || !inside(root, await realpath(file)) || !stat.isFile() || stat.isSymbolicLink()) throw new Error('Motion audit frames escape the job.');
    }
    pairs.push({ time: frame.time, reference: frame.path, preview: closest.path });
  }
  if (!pairs.length) return { defects: [], samples: [], reason: 'No aligned preview frames.' };
  if (!Number.isInteger(iteration) || iteration < 1 || iteration > 4) throw new Error('Invalid motion audit round.');
  const request = join(root, `motion-audit-request-${iteration}.json`);
  await writeFile(request, JSON.stringify({ job: root, mode: 'audit', pairs }));
  const { stdout } = await promisify(execFile)(motionPython(), ['-I', '-B', join(process.cwd(), 'scripts/measure-frame-motion.py'), request],
    { windowsHide: true, timeout: 60000, signal, maxBuffer: 2000000 });
  const report = JSON.parse(stdout);
  if (report.version !== 1 || report.samples?.length !== pairs.length || report.samples.some((sample, i) => sample.time !== pairs[i].time
    || !Number.isFinite(sample.addedEdgeGapFraction) || sample.addedEdgeGapFraction < 0 || sample.addedEdgeGapFraction > 1)) throw new Error('Invalid rendered motion audit.');
  const defects = coverageDefects(report.samples, `motion-audit-${iteration}.json: decoded, timestamp-aligned preview/reference pixels, including existing mattes. Native optical effects remain unverified.`);
  const spills = report.samples.filter(sample => sample.pictureSpillFraction > 0.015).sort((a, b) => b.pictureSpillFraction - a.pictureSpillFraction);
  if (spills.length) defects.push({ component: 'source / overlays / picture boundary', timeSeconds: spills[0].time,
    expected: 'Keep footage and graphics within the reference picture area at this time; account for encoded mattes and intentional entrances.',
    observed: `${Math.round(spills[0].pictureSpillFraction * 100)}% extra visible content spills into the reference border area. Inspect the source framing, graphic position and matte stacking together.`,
    evidence: `motion-audit-${iteration}.json: decoded candidate pixels outside the reference active-picture bounds.` });
  const result = { ...report, defects };
  await writeFile(join(root, `motion-audit-${iteration}.json`), JSON.stringify(result));
  return result;
}

export async function readMotionEvidence(job) {
  try { return JSON.parse(await readFile(join(job, 'motion-reference.json'), 'utf8')); }
  catch { return { samples: [], reason: 'No local correspondence measurements.' }; }
}

export async function buildMotionComparisons(job, plan, reference, source, preview, iteration, signal, defectTimes = []) {
  if (!reference?.frames?.length || !source?.frames?.length || !preview?.frames?.length || !await motionRuntimeReady()) return { images: [], layout: 'No synchronized full-size comparison available.' };
  const root = await realpath(job), pairs = [];
  const times = motionCheckTimes(plan, Math.min(reference.duration, source.duration, preview.duration), preview.sampleFps);
  // Put known bad frames in the limited image budget before ordinary boundaries.
  const prioritized = [...new Set([times[0], times.at(-1), ...defectTimes.slice(0, 4), ...times])].slice(0, 8).sort((a, b) => a - b);
  for (const time of prioritized) {
    const pair = { time };
    let aligned = true;
    for (const [key, index] of Object.entries({ reference, source, preview })) {
      const closest = index.frames.reduce((best, frame) => Math.abs(frame.time - time) < Math.abs(best.time - time) ? frame : best);
      if (Math.abs(closest.time - time) > 0.51 / index.sampleFps) { aligned = false; break; }
      const stat = await lstat(closest.path);
      if (!inside(root, closest.path) || !inside(root, await realpath(closest.path)) || !stat.isFile() || stat.isSymbolicLink()) throw new Error('Comparison frames escape the job.');
      pair[key] = closest.path; pair[`${key}Time`] = closest.time;
    }
    if (aligned) pairs.push(pair);
  }
  if (!pairs.length) return { images: [], layout: 'Frame times do not align.' };
  if (!Number.isInteger(iteration) || iteration < 1 || iteration > 4) throw new Error('Invalid comparison round.');
  const request = join(root, `motion-comparison-request-${iteration}.json`);
  await writeFile(request, JSON.stringify({ job: root, mode: 'comparison', pairs, outputFolder: `motion-comparison-${iteration}` }));
  const { stdout } = await promisify(execFile)(motionPython(), ['-I', '-B', join(process.cwd(), 'scripts/measure-frame-motion.py'), request],
    { windowsHide: true, timeout: 30000, signal, maxBuffer: 2000000 });
  const result = JSON.parse(stdout);
  if (result.version !== 1 || result.images?.length !== pairs.length || result.images.some(item => !inside(root, item.path))) throw new Error('Invalid comparison images.');
  await writeFile(join(root, `motion-comparison-${iteration}.json`), JSON.stringify(result));
  return result;
}
