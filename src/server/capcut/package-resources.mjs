import { copyFile, mkdir, realpath, lstat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path';
import { effectBundleFiles } from './effect-resources.mjs';

/** Keep generated media and complete effect bundles with the review project.
 * Source paths outside the job store are original dependencies, not ours to copy.
 */
export async function packageJobResources(draft, destination, jobStore) {
  const root = await realpath(jobStore), copied = new Map();
  for (const materials of Object.values(draft.materials || {})) {
    if (!Array.isArray(materials)) continue;
    for (const material of materials) {
      if (typeof material.path !== 'string' || !isAbsolute(material.path)) continue;
      const source = await realpath(material.path), offset = relative(root, source);
      if (offset === '..' || offset.startsWith(`..${sep}`) || isAbsolute(offset)) continue;
      if ((await lstat(material.path)).isSymbolicLink()) throw new Error('Generated resources cannot be linked.');
      // Walk every component too: a realpath check alone does not reject an
      // internal symlink that happens to resolve back into the job store.
      let parent = material.path;
      while (parent !== root && relative(root, parent) !== '') {
        if ((await lstat(parent)).isSymbolicLink()) throw new Error('Generated resource parents cannot be linked.');
        const next = dirname(parent); if (next === parent) throw new Error('Invalid generated resource path.'); parent = next;
      }
      let target = copied.get(source);
      if (!target) {
        const folder = join(destination, 'assets', 'ai-editor'); await mkdir(folder, { recursive: true });
        if ((await lstat(folder)).isSymbolicLink() || relative(await realpath(destination), await realpath(folder)).startsWith('..')) throw new Error('Invalid review resource destination.');
        target = join(folder, `${randomUUID().slice(0, 8)}-${basename(source)}`);
        const stat = await lstat(source);
        if (stat.isDirectory()) {
          // Preflight the complete directory before copying any shader, texture
          // or metadata. These files are data for CapCut, never executed here.
          const files = effectBundleFiles(source);
          await mkdir(target);
          for (const file of files) {
            const output = join(target, file.relative); await mkdir(dirname(output), { recursive: true });
            await copyFile(file.path, output);
          }
        } else if (stat.isFile()) {
          await copyFile(source, target);
          if (/\.(png|wav)$/.test(source)) for (const extension of source.endsWith('.png') ? ['.svg', '.source.json'] : ['.source.json']) {
            const companion = source.slice(0, -4) + extension;
            if (existsSync(companion)) {
              if (!(await lstat(companion)).isFile() || (await lstat(companion)).isSymbolicLink()) throw new Error('Invalid generated asset source.');
              await copyFile(companion, target.slice(0, -4) + extension);
            }
          }
        } else throw new Error('Unsupported generated resource type.');
        copied.set(source, target);
      }
      material.path = target.replaceAll('\\', '/');
    }
  }
  return copied.size;
}
