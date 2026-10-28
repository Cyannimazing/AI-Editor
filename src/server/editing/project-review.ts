import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readNativeDraft } from '../../lib/reference-edit-loop';
import { directoryDigest } from './transaction';
import { captureNativePreview } from '../capcut/native-preview.mjs';
import { reviewAndManage } from './review';
import { referenceEvidenceContext } from './reference-context.mjs';
import { qualityAction, combineReviews } from './quality.mjs';
import { auditMotionFrames, buildMotionComparisons } from './motion-evidence.mjs';
import { applyFinalProjectChecks } from './project-review-checks.mjs';

/** Earlier clip reviews must never be reused as final-revision evidence. */
export async function reviewFinalProjectClip(input: { result: { jobPath: string; candidatePath: string; prompt: string; iterations: number; sourceName: string; referencePath: string };
  candidate: string; onLog: (line: string) => void; signal?: AbortSignal }) {
  const { result, candidate, onLog, signal } = input, job = result.jobPath;
  const read = async (file: string) => JSON.parse(await readFile(join(job, file), 'utf8'));
  const spec = await read('spec.json'), plan = await read('controlled-editing-plan.json'), manifest = await read('manifest.json');
  const revision = await directoryDigest(candidate);
  let quality = combineReviews([], plan.techniques, false, revision, [...plan.unsupported, ...(manifest.verificationGaps || [])]);
  let evidencePath = '';
  try {
    const before = (await readNativeDraft(result.candidatePath)).draft, final = (await readNativeDraft(candidate)).draft;
    const componentIds = manifest.effects.flatMap((effect: { segmentIds: string[] }) => effect.segmentIds);
    for (const id of componentIds) {
      const old = before.tracks.flatMap(track => track.segments).find(segment => segment.id === id);
      const now = final.tracks.flatMap(track => track.segments).find(segment => segment.id === id);
      if (!old || JSON.stringify(old) !== JSON.stringify(now)) throw new Error('An earlier clip component changed during project integration.');
    }
    // Read-only reviewers inspect the final candidate with the original clip's
    // bounded job evidence and request, not an intermediate timeline.
    await writeFile(join(job, 'spec.json'), JSON.stringify({ ...spec, candidate }));
    onLog(`Checking “${result.sourceName}” in the final project revision.`);
    const captured = await captureNativePreview({ job, candidate, revision, start: spec.source.start, duration: spec.source.duration,
      width: spec.source.width, height: spec.source.height, signal, onLog });
    evidencePath = captured.receiptPath;
    const refIndex = await read('reference-frames.json').catch(() => null);
    const referenceFrames = refIndex?.sheets?.map((sheet: { path: string }) => sheet.path) || (/\.(png|jpe?g|webp)$/i.test(result.referencePath) ? [result.referencePath] : []);
    const nativeIndex = JSON.parse(await readFile(captured.nativeFrames.indexPath, 'utf8'));
    const sourceIndex = await read('source-evidence/reference-frames.json').catch(() => null);
    const motionEvidence = await read('motion-reference.json');
    const audit = await auditMotionFrames(job, refIndex, nativeIndex, motionEvidence, result.iterations, signal);
    const comparisons = await buildMotionComparisons(job, plan, refIndex, sourceIndex, nativeIndex, result.iterations, signal,
      audit.defects.map((defect: { timeSeconds: number }) => defect.timeSeconds));
    quality = await reviewAndManage({ job, candidate, request: result.prompt, referenceFrames, previewFrames: captured.nativeFrames.frames,
      comparisonFrames: comparisons.images.map((item: { path: string }) => item.path), comparisonContext: comparisons.layout,
      referenceEvidence: refIndex ? referenceEvidenceContext({ path: result.referencePath, frames: referenceFrames }, refIndex) : 'Instruction-only or still-image reference.',
      previewEvidence: referenceEvidenceContext(captured.nativeFrames, nativeIndex), nativeVerified: true, nativeReceiptPath: evidencePath,
      iteration: result.iterations, signal, onLog });
    const mix = await read(`audio-mix-report-${result.iterations}.json`).catch(() => null);
    quality = applyFinalProjectChecks(quality, audit, plan, mix);
  } catch (error) {
    signal?.throwIfAborted();
    const reason = error instanceof Error ? error.message : String(error);
    onLog(`Final project verification needs attention: ${reason}`);
    quality = { ...quality, decision: 'blocked', nativeVerified: false, unknowns: [...quality.unknowns, reason] };
  }
  await writeFile(join(job, 'final-project-quality.json'), JSON.stringify(quality));
  return { quality, evidencePath, verified: qualityAction(quality, 4, 4) === 'approve' };
}
