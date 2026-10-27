import { nativePose } from './motion-preview.mjs';

/** Closest translation at the smallest non-shrinking scale that covers the
 * reference picture. This is an explicit alternative, never a silent mutation.
 * Return it to the editor together with the original observation/tradeoff.
 */
export function feasibleFraming(sample, width, height) {
  const s = sample.sourceBounds, t = sample.referenceBounds, observed = sample.transform;
  if (!s || !t || !observed || sample.status !== 'matched') return null;
  const angle = observed.rotation * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle);
  const inverse = (x, y) => [cos * x + sin * y, -sin * x + cos * y];
  const corners = [[t.left, t.top], [t.right, t.top], [t.right, t.bottom], [t.left, t.bottom]]
    .map(([x, y]) => inverse((x - 0.5) * width, (y - 0.5) * height));
  const minX = Math.min(...corners.map(p => p[0])), maxX = Math.max(...corners.map(p => p[0]));
  const minY = Math.min(...corners.map(p => p[1])), maxY = Math.max(...corners.map(p => p[1]));
  const scale = Math.max(observed.scale, (maxX - minX) / ((s.right - s.left) * width), (maxY - minY) / ((s.bottom - s.top) * height));
  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
  const [x, y] = inverse(observed.x * width / 2, -observed.y * height / 2);
  const tx = clamp(x, maxX - scale * (s.right - 0.5) * width, minX - scale * (s.left - 0.5) * width);
  const ty = clamp(y, maxY - scale * (s.bottom - 0.5) * height, minY - scale * (s.top - 0.5) * height);
  const px = cos * tx - sin * ty, py = sin * tx + cos * ty;
  return { scale, x: px * 2 / width, y: -py * 2 / height, rotation: observed.rotation,
    constraint: 'Active picture coverage only. This changes framing; compare subject placement, smooth the full trajectory and preserve intentional reference mattes. Not proof of a reference match.' };
}

/** Test the reference's active picture against the transformed source picture.
 * Edge mattes stay separate from picture coordinates. No invented crop or zoom
 * is applied here: defects go to the editor, with both constraints visible.
 */
export function sourceCoverage(segment, report, width, height) {
  let samples = report.samples || [];
  if (report.fullFrameCoverage) {
    const { duration, fps } = report.fullFrameCoverage;
    const count = Math.min(600, Math.max(2, Math.ceil(duration * fps)));
    const end = Math.max(0, duration - 1 / fps);
    const times = new Set(Array.from({ length: count }, (_, i) => end * i / (count - 1)));
    // Include neighboring curve intervals, even for long clips sampled sparsely.
    const keys = [...new Set((segment.common_keyframes || []).flatMap(curve => curve.keyframe_list.map(frame => frame.time_offset / 1e6)))].sort((a, b) => a - b);
    keys.forEach((time, i) => { if (time < duration) times.add(time); if (i) for (const part of [0.25, 0.5, 0.75]) times.add(keys[i - 1] + (time - keys[i - 1]) * part); });
    const bounds = { left: 0, top: 0, right: 1, bottom: 1 };
    samples = [...times].sort((a, b) => a - b).map(time => ({ time, sourceBounds: bounds, referenceBounds: bounds }));
  } else if (!samples.some(sample => sample.status === 'matched')) return [];
  return samples.flatMap(sample => {
    const source = sample.sourceBounds, target = sample.referenceBounds;
    if (!source || !target) return [];
    const pose = nativePose(segment, sample.time, width, height);
    if (!(pose.scaleX > 0 && pose.scaleY > 0)) return [];
    const angle = -pose.rotation * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle);
    let missing = 0;
    const n = 25;
    for (let row = 0; row < n; row++) for (let col = 0; col < n; col++) {
      const x = (target.left + (target.right - target.left) * (col + 0.5) / n - 0.5) * width - pose.x;
      const y = (target.top + (target.bottom - target.top) * (row + 0.5) / n - 0.5) * height - pose.y;
      const sx = (cos * x - sin * y) / pose.scaleX / width + 0.5;
      const sy = (sin * x + cos * y) / pose.scaleY / height + 0.5;
      if (sx < source.left || sx > source.right || sy < source.top || sy > source.bottom) missing++;
    }
    return [{ time: sample.time, uncoveredFraction: missing / (n * n), sourceBounds: source, referenceBounds: target }];
  });
}

export function coverageDefects(samples, evidence) {
  // Keep correction context bounded without losing separate affected intervals.
  const failures = samples.filter(sample => sample.uncoveredFraction > 0.025 || sample.addedEdgeGapFraction > 0.025);
  const groups = [];
  for (const sample of failures) {
    const last = groups.at(-1);
    if (!last || sample.time - last.at(-1).time > 0.12) groups.push([sample]);
    else last.push(sample);
  }
  const value = s => s.addedEdgeGapFraction ?? s.uncoveredFraction;
  return groups.sort((a, b) => Math.max(...b.map(value)) - Math.max(...a.map(value))).slice(0, 8).sort((a, b) => a[0].time - b[0].time).map(group => {
    const worst = group.reduce((a, b) => value(a) >= value(b) ? a : b);
    return { component: 'source / picture coverage', timeSeconds: worst.time,
      expected: 'Preserve the reference picture area throughout motion. Account for existing letterbox bars, keep the intended composition and repair exposed edges; a sparse landmark fit is not an executable framing plan.',
      observed: `${Math.round(value(worst) * 100)}% of the reference picture is uncovered at ${worst.time.toFixed(4)}s (affected interval ${group[0].time.toFixed(4)}–${group.at(-1).time.toFixed(4)}s).`,
      evidence };
  });
}

/** Deterministic failures cannot be erased by either AI reviewer. */
export function includeMotionDefects(findings, defects, techniques = []) {
  if (!defects.length) return findings;
  return { ...findings, decision: 'revise', summary: 'Motion/frame coverage needs correction.',
    defects: [...defects, ...findings.defects],
    techniques: findings.techniques.map(item => techniques.find(technique => technique.id === item.id)?.components?.includes('source')
      ? { ...item, status: 'defect' } : item) };
}
