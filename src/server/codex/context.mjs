import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve, relative, isAbsolute } from 'node:path';

/** Context comes from an explicit, reviewed index; prompts cannot choose filesystem paths. */
export async function loadRoleInstructions(root, role) {
  const index = JSON.parse(await readFile(join(root, 'context-index.json'), 'utf8'));
  if (index.version !== 1 || !Object.hasOwn(index.roles, role)) throw new Error('Unknown AI editing role.');
  const paths = [...new Set([...index.shared, `roles/${role}.md`, ...index.roles[role]])];
  const loaded = await Promise.all(paths.map(async path => {
    const full = resolve(root, path), offset = relative(resolve(root), full);
    if (!offset || offset === '..' || offset.startsWith('../') || offset.startsWith('..\\') || isAbsolute(offset) || !path.endsWith('.md')) throw new Error('Invalid AI context reference.');
    const contents = await readFile(full, 'utf8');
    if (Buffer.byteLength(contents) > 24000) throw new Error(`AI context file exceeds its budget: ${path}`);
    return { path, contents, sha256: createHash('sha256').update(contents).digest('hex') };
  }));
  const text = loaded.map(file => `Context: ai/${file.path}\n${file.contents}`).join('\n\n');
  if (Buffer.byteLength(text) > 55000) throw new Error('The role context exceeds its total budget.');
  return { text, sources: loaded.map(({ path, sha256 }) => ({ path, sha256 })), version: index.version };
}
