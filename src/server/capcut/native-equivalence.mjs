import { createHash } from 'node:crypto';
import { readFile, lstat } from 'node:fs/promises';
import { isAbsolute, join, resolve, relative, dirname } from 'node:path';
import { existsSync } from 'node:fs';
import { directoryDigest } from '../editing/transaction.ts';
import { assertNoLinks } from '../security/paths.ts';
import { loadDraft } from '../../../toolchain/node_modules/capcut-cli/dist/draft.js';
import { normalizeNativeSave } from './native-save-normalization.mjs';

const identityFields = new Set(['id', 'name', 'create_time', 'update_time', 'version', 'new_version', 'platform', 'last_modified_platform', 'source']);
export function nativeSystemFont(executable, platform) {
  const root = platform === 'win32' ? dirname(executable) : platform === 'darwin' ? dirname(dirname(executable)) : null;
  return root ? join(root, 'Resources/Font/SystemFont/en.ttf') : undefined;
}
async function normalized(draft, root) {
  const copy = structuredClone(draft);
  for (const key of identityFields) delete copy[key];
  for (const list of Object.values(copy.materials || {})) if (Array.isArray(list)) for (const material of list) {
    // Sidecar registration IDs are publication identities, not editing controls.
    delete material.local_material_id;
    if (typeof material.path === 'string' && /^##_draftpath_placeholder_[a-f\d-]+_##\//i.test(material.path)) {
      if (!root) throw new Error('Missing native project resource root.');
      const path = resolve(root, material.path.replace(/^##_draftpath_placeholder_[a-f\d-]+_##\//i, ''));
      if (relative(root, path).startsWith('..') || isAbsolute(relative(root, path))) throw new Error('Escaping native project resource.');
      await assertNoLinks(root); material.path = path;
    }
    if (typeof material.path !== 'string' || !isAbsolute(material.path)) continue;
    const info = await lstat(material.path);
    if (info.isSymbolicLink()) throw new Error('Linked inspection resource.');
    if (info.isDirectory()) await assertNoLinks(material.path);
    material.path = info.isDirectory() ? await directoryDigest(material.path)
      : createHash('sha256').update(await readFile(material.path)).digest('hex');
  }
  return copy;
}
function authored(reference, value, path = '') {
  if (Array.isArray(reference)) {
    if (!Array.isArray(value) || value.length !== reference.length) throw new Error(`Published content differs at ${path}.`);
    return reference.map((item, i) => authored(item, value[i], `${path}.${i}`));
  }
  if (reference && typeof reference === 'object') {
    if (!value || typeof value !== 'object') throw new Error(`Published content differs at ${path}.`);
    const keys = [...new Set([...Object.keys(reference), ...Object.keys(value)])].sort();
    return Object.fromEntries(keys.map(key => [key, authored(reference[key], value[key], `${path}.${key}`)]));
  }
  if (reference !== value) throw new Error(`Published content differs at ${path}.`);
  return value;
}
const stacking = draft => [new Set(['video', 'image', 'text', 'sticker', 'subtitle', undefined]), new Set(['effect', 'filter'])].map(types =>
  (draft.tracks || []).flatMap((track, t) => types.has(track.type) ? (track.segments || []).map((s, i) => ({ id: s.id, render: s.render_index || 0, t, i })) : [])
    .sort((a, b) => a.render - b.render || a.t - b.t || a.i - b.i).map(s => s.id));

/** No repair or native rewrite is silently treated as the same candidate. */
export async function assertDraftEquivalent(reference, published, options = {}) {
  const a = await normalized(reference, options.referenceRoot), b = await normalized(published, options.publishedRoot);
  const orderA = stacking(a), orderB = stacking(b);
  if (options.nativeSave) {
    for (const draft of [a, b]) {
      for (const material of draft.materials?.texts || []) {
        if (!material.font_id && !material.font_resource_id && !material.font_name && material.font_path && options.systemFont
          && resolve(material.font_path) === resolve(options.systemFont)) delete material.font_path;
      }
      normalizeNativeSave(draft);
    }
  }
  if (JSON.stringify(authored(a, a)) !== JSON.stringify(authored(a, b))
    || JSON.stringify(orderA) !== JSON.stringify(orderB)) throw new Error('Published inspection content differs from the candidate. Rebuild before verification.');
}

export async function assertPublishedEquivalent(candidate, published, options = {}) {
  const read = path => loadDraft(path, { activeTimeline: existsSync(join(path, 'Timelines')) }).draft;
  const draft = read(published);
  await assertDraftEquivalent(read(candidate), draft, { ...options, referenceRoot: candidate, publishedRoot: published });
  return draft;
}
