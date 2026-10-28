import { nativePose, nativeCurveValue } from './motion-preview.mjs';
import { writeMotionCurves } from './native-controls.mjs';
import { addKeyframes } from '../../../toolchain/node_modules/capcut-cli/dist/decorators.js';
import { sourceCoverage, coverageDefects } from './motion-coverage.mjs';

const geometry = ['scale', 'x', 'y', 'rotation'];
function sourceSegment(source, fps) {
  const segment = { id: 'source', clip: { scale: { x: source.scale, y: source.scale }, transform: { x: source.x, y: source.y }, rotation: source.rotation }, common_keyframes: [] };
  const operations = source.keyframes.filter(frame => geometry.includes(frame.property)).flatMap(frame =>
    (frame.property === 'scale' ? ['scale_x', 'scale_y'] : [({ x: 'position_x', y: 'position_y' })[frame.property] || frame.property])
      .map(property => ({ op: 'keyframe', target: 'source', property, time: frame.time, value: frame.value, easing: frame.easing })));
  writeMotionCurves({ fps, tracks: [{ segments: [segment] }] }, operations, { source: 'source' }, addKeyframes);
  return segment;
}

/** Report velocity from serialized curves, not keyframe counts. These are
 * observations for the specialist: a stop is a defect only if travel was intended.
 */
export function motionDynamics(segment, start = 0, duration = segment.target_timerange?.duration / 1e6) {
  const round = value => Math.round(value * 1e6) / 1e6;
  return (segment.common_keyframes || []).map(curve => {
    const frames = curve.keyframe_list;
    const intervals = frames.slice(1).map((b, i) => {
      const a = frames[i], span = b.time_offset - a.time_offset;
      const rate = fraction => {
        const center = a.time_offset + span * fraction, h = span * .005;
        return round((nativeCurveValue(frames, center + h, 0) - nativeCurveValue(frames, center - h, 0)) / (2 * h / 1e6));
      };
      return { range: [round(start + a.time_offset / 1e6), round(start + b.time_offset / 1e6)],
        from: a.values[0], to: b.values[0], kind: a.values[0] === b.values[0] ? 'hold' : 'travel',
        startRate: rate(.05), midRate: rate(.5), endRate: rate(.95) };
    });
    const hold = (from, to, value) => ({ range: [round(start + from), round(start + to)], from: value, to: value,
      kind: 'hold', startRate: 0, midRate: 0, endRate: 0 });
    if (frames.length && frames[0].time_offset > 0) intervals.unshift(hold(0, frames[0].time_offset / 1e6, frames[0].values[0]));
    if (frames.length && Number.isFinite(duration) && frames.at(-1).time_offset / 1e6 < duration)
      intervals.push(hold(frames.at(-1).time_offset / 1e6, duration, frames.at(-1).values[0]));
    const stopCandidates = intervals.slice(1).flatMap((b, i) => {
      const a = intervals[i];
      if (a.kind !== 'travel' || b.kind !== 'travel' || Math.sign(a.to - a.from) !== Math.sign(b.to - b.from)) return [];
      const baseline = Math.min(Math.abs(a.midRate), Math.abs(b.midRate));
      return baseline > 1e-7 && Math.max(Math.abs(a.endRate), Math.abs(b.startRate)) < baseline * .35
        ? [{ time: b.range[0], reason: 'Same-direction travel slows near zero on both sides of this keyframe. Check for an unintended restart.' }] : [];
    });
    return { property: curve.property_type, rateUnits: 'native property units per second; sampled at 5%, 50%, 95% of each interval', intervals, stopCandidates };
  });
}

export function plannedMotionDynamics(plan, { fps = 30, duration } = {}) {
  return [{ component: 'source', item: plan.source }, ...(plan.overlays || []).map((item, i) => ({ component: `overlay-${i}`, item })),
    ...plan.texts.map((item, i) => ({ component: `text-${i}`, item }))].map(({ component, item }) => ({ component,
      curves: motionDynamics(sourceSegment(item, fps), item.start || 0, item.duration ?? duration) }));
}

function projection(pose, x, y) {
  const angle = pose.rotation * Math.PI / 180;
  return [pose.x + Math.cos(angle) * x * pose.scaleX - Math.sin(angle) * y * pose.scaleY,
    pose.y + Math.sin(angle) * x * pose.scaleX + Math.cos(angle) * y * pose.scaleY];
}

export function compareSourceMotion(segment, report, width, height) {
  return (report.samples || []).filter(sample => sample.status === 'matched').map(sample => {
    const actual = nativePose(segment, sample.time, width, height), expected = sample.transform;
    const target = { x: expected.x * width / 2, y: -expected.y * height / 2, scaleX: expected.scale, scaleY: expected.scale, rotation: expected.rotation };
    const points = [[0, 0], [-width / 4, -height / 4], [width / 4, -height / 4], [-width / 4, height / 4], [width / 4, height / 4]];
    const rmsPixels = Math.sqrt(points.reduce((sum, [x, y]) => {
      const a = projection(actual, x, y), b = projection(target, x, y);
      return sum + (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;
    }, 0) / points.length);
    return { time: sample.time, expected, actual: { scaleX: actual.scaleX, scaleY: actual.scaleY, x: actual.x * 2 / width, y: -actual.y * 2 / height, rotation: actual.rotation },
      rmsPixels: Math.round(rmsPixels * 100) / 100, mismatch: rmsPixels > Math.max(4, Math.hypot(width, height) * 0.012) };
  });
}

/** A repair cannot silently replace a better source curve with a measured regression.
 * Restore geometry only: new text, effects, color, sound and other valid work survive.
 */
export function guardSourceMotion(previous, proposed, report, { width, height, fps = 30 }) {
  if (!previous) return { plan: proposed, reverted: false, regressions: [] };
  // A correspondence requiring nonexistent source pixels is not a constraint
  // to preserve. Older receipts lack this feasibility evidence: do not lock them.
  const feasible = { ...report, samples: (report.samples || []).filter(sample => sample.directlyApplicable === true) };
  const beforeSegment = sourceSegment(previous.source, fps), afterSegment = sourceSegment(proposed.source, fps);
  // Never restore a curve that already exposes the picture's edges. Visible
  // defects outrank a smaller landmark residual, including at unmatched times.
  if (sourceCoverage(beforeSegment, report, width, height).some(sample => sample.uncoveredFraction > 0.025))
    return { plan: proposed, reverted: false, regressions: [], reason: 'Previous curve has uncovered picture area; allow its repair.' };
  const before = compareSourceMotion(beforeSegment, feasible, width, height);
  const after = compareSourceMotion(afterSegment, feasible, width, height);
  const tolerance = Math.max(4, Math.hypot(width, height) * 0.015);
  const regressions = after.filter((sample, i) => sample.rmsPixels > before[i].rmsPixels + tolerance);
  if (!regressions.length) return { plan: proposed, reverted: false, regressions: [] };
  const plan = structuredClone(proposed);
  for (const property of geometry) plan.source[property] = previous.source[property];
  plan.source.keyframes = [...proposed.source.keyframes.filter(frame => !geometry.includes(frame.property)),
    ...structuredClone(previous.source.keyframes.filter(frame => geometry.includes(frame.property)))];
  return { plan, reverted: true, regressions: regressions.map(sample => ({ ...sample, previousRmsPixels: before.find(item => item.time === sample.time).rmsPixels })) };
}

export function plannedMotionDefects(plan, report, { width, height, fps = 30 }) {
  return coverageDefects(sourceCoverage(sourceSegment(plan.source, fps), report, width, height),
    'Host sampled proposed source curves against measured source/reference active-picture bounds. Check rendered evidence when another layer deliberately fills the background.');
}

/** Sampling priorities include short motion/effect boundaries and the full duration. */
export function motionCheckTimes(plan, duration, fps = 30, maximum = 8) {
  const last = Math.max(0, Math.floor((duration - 1 / fps) * fps + 1e-5) / fps);
  const times = new Map([[0, 10], [last, 10], [Math.round(last * fps / 2) / fps, 6]]);
  const put = (time, priority) => { const t = Math.max(0, Math.min(last, Math.round(time * fps) / fps)); times.set(t, Math.max(times.get(t) || 0, priority)); };
  for (const item of [plan.source, ...(plan.overlays || []), ...plan.texts]) {
    const start = item.start || 0;
    for (const frame of item.keyframes) if (geometry.includes(frame.property) || frame.property === 'opacity') {
      const fast = item.keyframes.some(other => other.property === frame.property && other !== frame && Math.abs(other.time - frame.time) <= 0.15 && other.value !== frame.value);
      put(start + frame.time, fast ? 8 : 4); if (frame.time > 0) put(start + frame.time - 1 / fps, 2);
    }
  }
  for (const effect of plan.effects || []) for (const time of [effect.start, effect.start + effect.duration]) { put(time, 5); put(time - 1 / fps, 3); }
  const ranked = [...times].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  const selected = ranked.slice(0, Math.min(3, maximum)).map(([time]) => time);
  // Choose temporally diverse boundaries; do not let a long edit lose its ending.
  while (selected.length < Math.min(maximum, ranked.length)) {
    const next = ranked.filter(([time]) => !selected.includes(time)).sort((a, b) =>
      (b[1] + Math.min(...selected.map(t => Math.abs(t - b[0]))) * 2) - (a[1] + Math.min(...selected.map(t => Math.abs(t - a[0]))) * 2))[0];
    selected.push(next[0]);
  }
  return selected.sort((a, b) => a - b);
}

export function motionCurveReport(plan, draft, refs, report, { width, height, duration, fps = 30 }) {
  const times = motionCheckTimes(plan, duration, fps);
  const components = Object.entries(refs).filter(([ref]) => !ref.startsWith('effect-') && !ref.startsWith('audio-')).map(([ref, id]) => {
    const segment = draft.tracks.flatMap(track => track.segments).find(item => item.id === id);
    if (!segment) throw new Error(`Missing motion component ${ref}.`);
    const start = ref === 'source' ? 0 : (ref.startsWith('text-') ? plan.texts[Number(ref.slice(5))] : plan.overlays[Number(ref.slice(8))]).start;
    return { component: ref, segmentId: id, dynamics: motionDynamics(segment, start), nativeCurves: (segment.common_keyframes || []).map(curve => ({ property: curve.property_type,
      frames: curve.keyframe_list.map(frame => ({ seconds: frame.time_offset / 1e6, value: frame.values[0], interpolation: frame.curveType, left: frame.left_control, right: frame.right_control })) })),
      samples: times.filter(time => time >= start && time < start + segment.target_timerange.duration / 1e6).map(time => ({ time, ...nativePose(segment, time - start, width, height) })) };
  });
  const source = draft.tracks.flatMap(track => track.segments).find(item => item.id === refs.source);
  return { version: 1, times, coordinates: 'Full canvas; sample translations are pixels, y positive downward. Native curve values retain native units.',
    components, sourceComparison: compareSourceMotion(source, report, width, height), sourceCoverage: sourceCoverage(source, report, width, height), nativeVerified: false,
    limitations: ['Serialized curve sampling checks construction, not native playback.', 'Shared-footage geometry is not a measurement of smear, RGB fringes, masks or audio.'] };
}
