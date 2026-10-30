import { copyFile, mkdir, realpath, lstat } from 'node:fs/promises';
import { createReadStream, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path';
import { effectBundleFiles } from './effect-resources.mjs';

async function fingerprint(path) {
  const info = await lstat(path);
  if (info.isSymbolicLink() || !(info.isFile() || info.isDirectory())) throw new Error('Invalid packaged resource.');
  const files = info.isDirectory() ? effectBundleFiles(path).map(file => ({ path: file.path, key: file.relative })) : [{ path, key: 'media' }];
  if (info.isFile() && /\.(png|wav)$/.test(path)) for (const extension of path.endsWith('.png') ? ['.svg', '.source.json'] : ['.source.json']) {
    const companion = path.slice(0, -4) + extension;
    if (existsSync(companion)) {
      const checked = await lstat(companion);
      if (!checked.isFile() || checked.isSymbolicLink()) throw new Error('Invalid generated asset source.');
      files.push({ path: companion, key: extension });
    }
  }
  const hash = createHash('sha256');
  for (const file of files.sort((a, b) => a.key.localeCompare(b.key))) {
    const content = createHash('sha256'); for await (const bytes of createReadStream(file.path)) content.update(bytes);
    hash.update(JSON.stringify([file.key, content.digest('hex')]));
  }
  return hash.digest('hex');
}

/** Keep generated media and complete effect bundles with the review project.
 * Source paths outside the job store are original dependencies, not ours to copy.
 */
export async function packageJobResources(draft, destination, jobStore, materialIds) {
  const root = await realpath(jobStore), copied = new Map();
  for (const materials of Object.values(draft.materials || {})) {
    if (!Array.isArray(materials)) continue;
    for (const material of materials) {
      if (materialIds && !materialIds.has(material.id)) continue;
      if (typeof material.path !== 'string' || !isAbsolute(material.path)) continue;
      const source = await realpath(material.path), offset = relative(root, source);
      if (offset === '..' || offset.startsWith(`..${sep}`) || isAbsolute(offset)) continue;
      if (material.path.split(/[\\/]/).includes('..')) throw new Error('Generated resource paths cannot contain parent traversal.');
      if ((await lstat(material.path)).isSymbolicLink()) throw new Error('Generated resources cannot be linked.');
      // Inspect the original components, but stop at the canonical job boundary.
      // macOS /var -> /private/var aliases above that boundary are legitimate.
      // Walking only `source` would hide internal links that resolve in-store.
      let parent = material.path;
      while (true) {
        if ((await lstat(parent)).isSymbolicLink()) throw new Error('Generated resource parents cannot be linked.');
        if (relative(root, await realpath(parent)) === '') break;
        const next = dirname(parent); if (next === parent) throw new Error('Invalid generated resource path.'); parent = next;
      }
      let target = copied.get(source);
      if (!target) {
        const folder = join(destination, 'assets', 'ai-editor'); await mkdir(folder, { recursive: true });
        if ((await lstat(folder)).isSymbolicLink() || relative(await realpath(destination), await realpath(folder)).startsWith('..')) throw new Error('Invalid review resource destination.');
        const hash = await fingerprint(source);
        target = join(folder, `${hash.slice(0, 24)}-${basename(source)}`);
        const stat = await lstat(source);
        if (existsSync(target)) {
          if (await fingerprint(target) !== hash) throw new Error('A cached packaged resource changed.');
        } else if (stat.isDirectory()) {
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
        if (await fingerprint(target) !== hash) throw new Error('Resource bytes changed while being packaged.');
        copied.set(source, target);
      }
      material.path = target.replaceAll('\\', '/');
    }
  }
  return copied.size;
}
