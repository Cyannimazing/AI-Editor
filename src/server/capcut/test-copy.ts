import { refuseDesktopControl } from './desktop-policy.mjs';

/** Retain the old API entry point without letting an older browser control the desktop. */
export async function openCandidateTestCopy(candidatePath: string, revision: string, jobPath: string): Promise<{
  projectName: string; status: string; projectVisible: boolean; receiptPath: string;
}> {
  void candidatePath; void revision; void jobPath;
  refuseDesktopControl();
  throw new Error('Desktop control is disabled.');
}
