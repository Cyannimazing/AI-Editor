import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname } from "node:path";

export async function acquireLock(path: string) {
  await mkdir(dirname(path), { recursive: true });
  const owner = randomUUID();
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const file = await open(path, "wx");
      await file.writeFile(JSON.stringify({ pid: process.pid, owner, createdAt: new Date().toISOString() })); await file.close();
      return async () => { try { if (JSON.parse(await readFile(path, "utf8")).owner === owner) await unlink(path); } catch { /* already released */ } };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      let previous: { pid: number };
      try { previous = JSON.parse(await readFile(path, "utf8")); } catch { throw new Error("A job lock needs recovery. No new edit was started."); }
      if (!Number.isInteger(previous.pid) || previous.pid <= 0) throw new Error("Invalid job lock. No edit was started.");
      try { process.kill(previous.pid, 0); throw new Error("Another editing operation is active. Wait or stop it first."); }
      catch (probe) { if ((probe as NodeJS.ErrnoException).code !== "ESRCH") throw probe; }
      await rename(path, `${path}.interrupted-${randomUUID()}`);
    }
  }
  throw new Error("Could not acquire the editing lock.");
}
