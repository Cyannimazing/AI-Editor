import { prepareNativeCopy } from './native-copy.mjs';

/** User review and automatic inspection share the same non-repairing publisher. */
export async function openCandidateTestCopy(candidatePath: string, revision: string, jobPath: string) {
  const copy = await prepareNativeCopy(candidatePath, revision, undefined, jobPath);
  return { projectName: copy.projectName, status: copy.status, projectVisible: copy.projectVisible,
    receiptPath: copy.receiptPath };
}
