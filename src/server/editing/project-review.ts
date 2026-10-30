import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { directoryDigest } from './transaction';
import { qualityAction, combineReviews } from './quality.mjs';
import { captureFailureDiagnostic } from './diagnostics.mjs';
import { editingFailureMessage } from './errors.mjs';
import { carryForwardPreviewEvidence } from './preview-evidence.mjs';

/** Earlier clip evidence is reusable only when its entire visible interval is unchanged. */
export async function reviewFinalProjectClip(input: { result: { jobPath: string; candidatePath: string; sourceName: string;
  evidencePath: string; quality?: ReturnType<typeof combineReviews> }; candidate: string;
  onLog: (line: string) => void; signal?: AbortSignal }) {
  const { result, candidate, onLog, signal } = input, job = result.jobPath;
  const revision = await directoryDigest(candidate);
  let quality = result.quality || combineReviews([], [], false, revision, [], 'preview');
  let evidencePath = '';
  let diagnostic: ReturnType<typeof captureFailureDiagnostic> | undefined;
  try {
    signal?.throwIfAborted();
    if (quality.reviewMode !== 'preview') throw new Error('This clip needs a fresh file and preview review.');
    onLog(`Checking preserved preview evidence for ${result.sourceName} in the final project.`);
    const checked = await carryForwardPreviewEvidence(job, result.candidatePath, candidate, result.evidencePath);
    quality = checked.quality; evidencePath = checked.evidencePath;
  } catch (error) {
    signal?.throwIfAborted();
    const reason = editingFailureMessage(error);
    quality = { ...quality, candidateDigest: revision, decision: 'blocked', nativeVerified: false, unknowns: [...quality.unknowns, reason] };
    diagnostic = captureFailureDiagnostic(error); onLog(reason);
  }
  await writeFile(join(job, 'final-project-quality.json'), JSON.stringify(quality));
  return { quality, evidencePath, diagnostic, verified: qualityAction(quality, 4, 4) === 'approve' };
}
