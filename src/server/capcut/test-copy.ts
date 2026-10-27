import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, lstat, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { directoryDigest } from "../editing/transaction";
import { assertNoLinks, containedPath } from "../security/paths";
import { platformPaths } from "../platform/runtime.mjs";

const run = promisify(execFile);

export async function openCandidateTestCopy(candidatePath: string, revision: string) {
  const workspace = process.cwd();
  const candidate = await containedPath(join(workspace, ".local-tools", "staging"), candidatePath);
  await assertNoLinks(candidate);
  if (await directoryDigest(candidate) !== revision) throw new Error("The candidate changed. Build a new candidate before opening a test copy.");
  const drafts = platformPaths().drafts;
  await mkdir(drafts, { recursive: true });
  if ((await lstat(drafts)).isSymbolicLink()) throw new Error("Linked CapCut libraries are not supported.");
  const index = join(drafts, "root_meta_info.json");
  if (existsSync(index) && (await lstat(index)).isSymbolicLink()) throw new Error("Linked CapCut library indexes are not supported.");
  const session = join(workspace, "scripts", "capcut-session.mjs");
  // Graceful close lets CapCut save its current work before registration. Never force-kill.
  await run(process.execPath, [session, "close"], { timeout: 45000, windowsHide: true });
  const destination = join(drafts, `AI Editor test ${randomUUID().slice(0, 8)}`);
  await run(process.execPath, [join(workspace, "scripts", "capcut-draft.mjs"), "publish", candidate, destination], { timeout: 60000, windowsHide: true });
  await run(process.execPath, [join(workspace, "toolchain", "node_modules", "capcut-cli", "dist", "index.js"),
    "register", destination, "--apply", "--materials", "--drafts", drafts,
    ...(existsSync(join(destination, 'Timelines')) ? ["--active-timeline"] : [])], { timeout: 60000, maxBuffer: 2_000_000, windowsHide: true });
  // Newer CapCut versions resolve registered media through local_material_id.
  await run(process.execPath, [join(workspace, 'toolchain/node_modules/capcut-cli/dist/index.js'), 'lint', destination, '--fix', '--json',
    ...(existsSync(join(destination, 'Timelines')) ? ['--active-timeline'] : [])], { timeout: 60000, windowsHide: true });
  await run(process.execPath, [session, "open", destination], { timeout: 45000, windowsHide: true });
  const metadata = JSON.parse(await readFile(join(destination, "draft_meta_info.json"), "utf8"));
  return { projectName: String(metadata.draft_name || "AI Editor review") };
}
