import { packageJobResources } from './package-resources.mjs';
import { assertProjectWriteVersion } from './project-version.mjs';
import { planChangedMediaRegistration } from '../../../toolchain/node_modules/capcut-cli/dist/materials-register.js';

function newMaterialIds(draft, original) {
  const previous = new Set(Object.values(original.materials || {}).flat().map(item => item.id));
  return new Set(Object.values(draft.materials || {}).flat().filter(item => !previous.has(item.id)).map(item => item.id));
}

/** Preserve the destination's existing entries; link new materials to their FINAL paths. */
export function planNewMediaRegistration(draft, project, original) {
  const ids = newMaterialIds(draft, original);
  const selected = [...(draft.materials.videos || []), ...(draft.materials.audios || [])].filter(item => ids.has(item.id) && item.path);
  if (!selected.length) return { registered: 0, additionalFiles: [] };
  const plan = planChangedMediaRegistration(draft, project, ids);
  if (!plan) throw new Error('The project media registry is missing or unreadable. Save the project in CapCut, then retry.');
  if (selected.some(item => !item.local_material_id)) throw new Error('A new media file has no registration link.');
  // saveDraft owns the compare-and-swap and rollback of the timeline AND registry.
  // Writing metadata here would also invalidate projects with an embedded timeline.
  return { registered: selected.length, additionalFiles: [plan] };
}

/** Controller/compiler only, before validation and preview; never changes original materials. */
export async function prepareCandidateMedia({ draft, original, project, jobStore, stagedResourceRoot }) {
  assertProjectWriteVersion(project);
  const ids = newMaterialIds(draft, original);
  let packaged = await packageJobResources(draft, project, jobStore, ids);
  // Multi-clip edits retain byte-bound references into earlier candidates during
  // review. At commit, copy those resources too; never retain staging dependencies.
  if (stagedResourceRoot) packaged += await packageJobResources(draft, project, stagedResourceRoot, ids);
  const { registered, additionalFiles } = planNewMediaRegistration(draft, project, original);
  return { receipt: { version: 1, packaged, registered, scope: 'new-materials-only' }, additionalFiles };
}
