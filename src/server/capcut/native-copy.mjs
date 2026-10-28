import { randomInt } from 'node:crypto';
import { mkdir, lstat, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { directoryDigest } from '../editing/transaction.ts';
import { assertNoLinks, containedPath } from '../security/paths.ts';
import { platformPaths } from '../platform/runtime.mjs';
import { runCancellableProcess } from '../../lib/cancellable-process.ts';
import { assertPublishedEquivalent } from './native-equivalence.mjs';

export async function prepareNativeCopy(candidatePath, revision, signal) {
  const workspace = process.cwd();
  const candidate = await containedPath(join(workspace, '.local-tools/staging'), candidatePath);
  await assertNoLinks(candidate);
  if (await directoryDigest(candidate) !== revision) throw new Error('The candidate changed before native inspection.');
  const drafts = platformPaths().drafts;
  await mkdir(drafts, { recursive: true });
  if ((await lstat(drafts)).isSymbolicLink()) throw new Error('Linked CapCut libraries are not supported.');
  const index = join(drafts, 'root_meta_info.json');
  if (existsSync(index) && (await lstat(index)).isSymbolicLink()) throw new Error('Linked CapCut library index.');
  const session = join(workspace, 'scripts/capcut-session.mjs');
  const run = async args => {
    const diagnostics = [];
    try { await runCancellableProcess(process.execPath, args, { cwd: workspace, signal, timeoutMs: 60000,
      onLine: line => { diagnostics.push(line.slice(0, 2000)); if (diagnostics.length > 10) diagnostics.shift(); } }); }
    catch (error) { if (signal?.aborted) throw error; throw new Error(`${error.message}\n${diagnostics.join('\n')}`); }
  };
  await run([session, 'close']);
  const projectName = `Verify ${randomInt(10000000, 100000000)}`;
  const destination = join(drafts, projectName);
  await run([join(workspace, 'scripts/capcut-draft.mjs'), 'publish', candidate, destination]);
  const cli = join(workspace, 'toolchain/node_modules/capcut-cli/dist/index.js');
  const active = existsSync(join(destination, 'Timelines')) ? ['--active-timeline'] : [];
  await run([cli, 'register', destination, '--apply', '--materials', '--drafts', drafts, ...active]);
  await run([join(workspace, 'scripts/capcut-draft.mjs'), 'link-media', destination]);
  const metadata = JSON.parse(await readFile(join(destination, 'draft_meta_info.json'), 'utf8'));
  if (metadata.draft_name !== projectName) throw new Error('Published project identity differs from the inspection target.');
  await assertPublishedEquivalent(candidate, destination);
  await writeFile(join(destination, '.ai-editor-review.json'), JSON.stringify({ kind: 'temporary-review', sourceCandidate: candidate, revision }));
  await run([session, 'open', destination]);
  return { projectName, destination, projectId: metadata.draft_id };
}
