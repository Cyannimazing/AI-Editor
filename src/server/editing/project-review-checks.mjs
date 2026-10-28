import { includeMotionDefects } from './motion-coverage.mjs';
import { includeAudioDefects } from './audio-mix.mjs';
import { requireAudioEvidence } from './quality.mjs';

/** Final integration review uses the same deterministic gates as a clip run. */
export function applyFinalProjectChecks(findings, audit, plan, mix) {
  if (!audit || !Array.isArray(audit.defects)) throw new Error('Final project motion audit is missing.');
  let checked = includeMotionDefects(findings, audit.defects, plan.techniques);
  if (mix) checked = includeAudioDefects(checked, mix, plan.techniques);
  return requireAudioEvidence(checked, Boolean(plan.audio?.clips.length), Boolean(mix));
}
