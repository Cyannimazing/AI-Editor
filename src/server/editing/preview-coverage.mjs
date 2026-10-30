import { intervalTracks } from './timeline-interval.mjs';
import { fidelityCensus } from '../../../toolchain/node_modules/capcut-cli/dist/render.js';

/** A model cannot approve behavior or overlapping layers its renderer omitted. */
export function previewCoverageIssues(draft, refs, interval, preview) {
  if (!preview) return ['The preview renderer did not produce a coverage report.'];
  const tracks = intervalTracks(draft, interval);
  const motion = preview.previewKind === 'native-curves-local-preview';
  const issues = [], included = new Set(Object.values(refs));
  if (motion) for (const track of tracks) for (const segment of track.segments) {
    if (track.type !== 'audio' && !included.has(segment.id)) issues.push(`The motion preview omits overlapping ${track.type} component ${segment.id}.`);
  }
  const scoped = { ...draft, tracks };
  const census = fidelityCensus(scoped, { allVideoTracks: true, burnCaptions: true });
  const rendered = new Set(motion ? ['keyframes', 'mix_modes', 'main_track_gaps'] : []);
  for (const [category, detail] of Object.entries(census.dropped)) {
    if (!rendered.has(category)) issues.push(`The preview cannot assess ${category} on ${detail.count} component(s) in this interval.`);
  }
  // Preserve actual render fallbacks (e.g. missing media) as blocking evidence.
  for (const [category, detail] of Object.entries(preview.fidelity?.dropped || {})) {
    if ((typeof detail === 'number' ? detail : detail?.count) > 0) issues.push(`The renderer reports omitted ${category}.`);
  }
  return [...new Set(issues)];
}
