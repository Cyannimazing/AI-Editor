import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { cp, mkdir, readdir, rename, writeFile, lstat, readFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";

export async function directoryDigest(root: string): Promise<string> {
  const hash = createHash("sha256");
  async function walk(folder: string) {
    for (const item of (await readdir(folder, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(folder, item.name);
      if ((await lstat(path)).isSymbolicLink()) throw new Error("Linked project files are not allowed.");
      hash.update(relative(root, path).replaceAll("\\", "/") + "\0");
      if (item.isDirectory()) { hash.update("directory\0"); await walk(path); }
      else if (item.isFile()) { hash.update("file\0"); for await (const chunk of createReadStream(path)) hash.update(chunk); hash.update("\0"); }
      else throw new Error("Unsupported project file type.");
    }
  }
  await walk(root); return hash.digest("hex");
}

/** Rollback replaces the directory, so files introduced by a failed write cannot survive. */
export async function transactionalWrite(input: {
  project: string; expectedDigest: string; journalRoot: string;
  beforeWrite?: () => Promise<void>;
  write: () => Promise<void>; validate: () => Promise<void>;
}) {
  await assertRecoveryClear(input.journalRoot, input.project);
  if (await directoryDigest(input.project) !== input.expectedDigest) throw new Error("The original project changed. Review a fresh candidate before approving.");
  const id = randomUUID();
  const folder = join(dirname(input.project), ".ai-editor-backups", id);
  const backup = join(folder, "original");
  await mkdir(folder, { recursive: true }); await mkdir(input.journalRoot, { recursive: true });
  const journal = join(input.journalRoot, `${id}.json`);
  const record = { id, project: input.project, backup, expectedDigest: input.expectedDigest, phase: "backing_up", updatedAt: "" };
  async function checkpoint(phase: string) {
    record.phase = phase; record.updatedAt = new Date().toISOString();
    const temp = `${journal}.tmp`; await writeFile(temp, JSON.stringify(record, null, 2)); await rename(temp, journal);
  }
  await checkpoint("backing_up");
  await cp(input.project, backup, { recursive: true, errorOnExist: true, force: false });
  if (await directoryDigest(backup) !== input.expectedDigest || await directoryDigest(input.project) !== input.expectedDigest) {
    await checkpoint("conflict"); throw new Error("The original changed during backup. No edit was applied.");
  }
  // A failed prerequisite has not mutated the project. Never restore a backup
  // over a concurrent save, or discard the caller's retryable error code.
  try { await input.beforeWrite?.(); }
  catch (error) { await checkpoint("aborted"); throw error; }
  if (await directoryDigest(input.project) !== input.expectedDigest) {
    await checkpoint("conflict"); throw new Error("The original changed before commit. No edit was applied.");
  }
  await checkpoint("committing");
  try { await input.write(); await input.validate(); await checkpoint("complete"); }
  catch (error) {
    // Failure to update the journal must not prevent a rollback attempt.
    try { await checkpoint("restoring"); } catch { /* previous committing record still blocks later writes */ }
    try {
      const restored = join(folder, "restored");
      await cp(backup, restored, { recursive: true, force: false, errorOnExist: true });
      if (await directoryDigest(restored) !== input.expectedDigest) throw new Error("Backup integrity check failed.");
      await rename(input.project, join(folder, "failed-candidate"));
      await rename(restored, input.project);
      await checkpoint("restored");
    } catch (recoveryError) {
      await checkpoint("recovery_required");
      throw new Error(`Recovery needs attention. Backup retained at ${backup}. ${recoveryError instanceof Error ? recoveryError.message : "Restore failed."}`);
    }
    throw new Error(`The edit failed; the complete original was restored. ${error instanceof Error ? error.message : "Commit failed."}`);
  }
  return { backup, journal };
}

/** Interrupted writes need recovery inspection before another commit can begin. */
export async function assertRecoveryClear(journalRoot: string, project: string) {
  let names: string[];
  try { names = await readdir(journalRoot); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
  for (const name of names.filter(name => /^[0-9a-f-]{36}\.json$/.test(name))) {
    const record = JSON.parse(await readFile(join(journalRoot, name), "utf8")) as { project: string; phase: string; backup: string };
    if (record.project === project && ["committing", "restoring", "recovery_required"].includes(record.phase))
      throw new Error(`An interrupted commit needs recovery inspection. Original backup: ${record.backup}. Further writes are blocked.`);
  }
}
