import { prepareNativeCopy } from './native-copy.mjs';

/** User review and automatic inspection share the same non-repairing publisher. */
export async function openCandidateTestCopy(candidatePath: string, revision: string) {
  const copy = await prepareNativeCopy(candidatePath, revision);
  return { projectName: copy.projectName };
}
