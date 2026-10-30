import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadDraft, loadedDraftStore } from '../../../toolchain/node_modules/capcut-cli/dist/draft.js';
import { assessWriteSafety } from '../../../toolchain/node_modules/capcut-cli/dist/version.js';
import { versionBoundaryMessage } from '../editing/errors.mjs';

/** Read-only: retain the upstream evidence ceiling, including newer mirrors. */
export function assertProjectWriteVersion(project) {
  const { draft, filePath } = loadDraft(project, { activeTimeline: existsSync(join(project, 'Timelines')) });
  const safety = assessWriteSafety(draft, loadedDraftStore(filePath).version);
  if (safety.action === 'refuse') throw Object.assign(new Error(versionBoundaryMessage), {
    code: 'CAPCUT_VERSION_UNSUPPORTED', compatibility: {
      appVersion: /^\d+(?:\.\d+){0,3}$/.test(safety.detected.app_version || '') ? safety.detected.app_version : null,
      schema: Number.isSafeInteger(safety.detected.schema_int) ? safety.detected.schema_int : null,
    },
  });
  return safety;
}
