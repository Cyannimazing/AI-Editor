import { writeFile } from 'node:fs/promises';
import { captureFailureDiagnostic } from '../editing/diagnostics.mjs';

/** Trusted publication operations; persist a checkpoint before each side effect. */
export async function runReviewCopy({ receiptPath, revision, projectName, platform = process.platform }, operations, signal) {
  const receipt = { version: 1, kind: 'review-copy', candidateDigest: revision, projectName, platform,
    status: 'preparing', stage: 'close', published: false, registered: false, projectVisible: false, steps: [] };
  const save = () => writeFile(receiptPath, JSON.stringify(receipt, null, 2));
  await save();
  try {
    for (const stage of ['close', 'publish', 'register', 'link-media', 'identity', 'equivalence', 'open']) {
      signal?.throwIfAborted();
      receipt.stage = stage;
      const step = { stage, status: 'running' }; receipt.steps.push(step); await save();
      await operations[stage]();
      step.status = 'passed';
      if (stage === 'publish') receipt.published = true;
      if (stage === 'register') receipt.registered = true;
      await save();
    }
    receipt.status = 'handoff_accepted';
    await save();
    return { projectName, status: receipt.status, projectVisible: false, receiptPath };
  } catch (error) {
    receipt.status = signal?.aborted ? 'cancelled' : 'failed';
    if (receipt.steps.at(-1)?.status === 'running') receipt.steps.at(-1).status = 'failed';
    const exitCode = Number.isInteger(error.code) ? error.code : /Process exited with code (\d+)\./.exec(error.message)?.[1];
    error.nativeFailure = { ...receipt, receiptPath, ...(exitCode !== undefined ? { wrapperExitCode: Number(exitCode) } : {}),
      ...(Number.isInteger(error.launchExitCode) ? { launchExitCode: error.launchExitCode } : {}) };
    receipt.diagnostic = captureFailureDiagnostic(error);
    await save();
    throw error;
  }
}
