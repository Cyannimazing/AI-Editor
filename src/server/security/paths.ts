import { realpath, lstat, readdir } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep, join } from "node:path";

export function inside(root: string, path: string) {
  const offset = relative(resolve(root), resolve(path));
  return offset === "" || (offset !== ".." && !offset.startsWith(`..${sep}`) && !isAbsolute(offset));
}
export async function containedPath(root: string, path: string) {
  const [base, target] = await Promise.all([realpath(root), realpath(path)]);
  if (!inside(base, target)) throw new Error("Path escapes the allowed directory.");
  return target;
}
export async function assertNoLinks(folder: string): Promise<void> {
  if ((await lstat(folder)).isSymbolicLink()) throw new Error("Linked project paths are not supported.");
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name);
    if ((await lstat(path)).isSymbolicLink()) throw new Error("Project contains a symlink or junction.");
    if (entry.isDirectory()) await assertNoLinks(path);
  }
}
