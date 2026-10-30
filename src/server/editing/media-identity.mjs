import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';

async function digest(path) {
  const hash = createHash('sha256');
  for await (const bytes of createReadStream(path)) hash.update(bytes);
  return hash.digest('hex');
}

/** A packaged source must be byte-identical, never a flattened replacement render. */
export async function matchesSourceBytes(path, sources) {
  const info = await stat(path);
  if (!info.isFile()) return false;
  let targetHash;
  for (const source of sources) {
    const other = await stat(source);
    if (!other.isFile() || other.size !== info.size) continue;
    targetHash ??= await digest(path);
    if (targetHash === await digest(source)) return true;
  }
  return false;
}
