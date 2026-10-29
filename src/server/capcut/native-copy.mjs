import { randomInt } from 'node:crypto';
import { mkdir, mkdtemp, lstat, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { directoryDigest } from '../editing/transaction.ts';
import { assertNoLinks, containedPath } from '../security/paths.ts';
import { platformPaths } from '../platform/runtime.mjs';
import { runCancellableProcess } from '../../lib/cancellable-process.ts';
import { assertPublishedEquivalent } from './native-equivalence.mjs';
import { runReviewCopy } from './native-copy-receipt.mjs';
import { nativeFailureCode, nativeFailureMessages } from '../editing/errors.mjs';

export async function runNativeCopyCommand(args, { cwd, signal }) {
  const diagnostics = [];
  let launchExitCode, hostFinding;
  try { await runCancellableProcess(process.execPath, args, { cwd, signal, timeoutMs: 60000,
    onLine: line => {
      const code = nativeFailureCode(line);
      if (code) hostFinding = nativeFailureMessages[code];
      try {
        const event = JSON.parse(line);
        if (event.kind === 'native-launch-failure' && Number.isInteger(event.launchExitCode)) launchExitCode = event.launchExitCode;
      } catch { /* Plain subprocess diagnostic. */ }
      diagnostics.push(line.slice(0, 2000)); if (diagnostics.length > 10) diagnostics.shift();
    } }); }
  catch (error) {
    if (signal?.aborted) throw error;
    throw Object.assign(new Error(`${error.message}\n${hostFinding || ''}\n${diagnostics.join('\n')}`), { launchExitCode });
  }
}

export async function prepareNativeCopy(candidatePath, revision, signal, receiptRoot) {
  const workspace = process.cwd();
  const candidate = await containedPath(join(workspace, '.local-tools/staging'), candidatePath);
  await assertNoLinks(candidate);
  if (await directoryDigest(candidate) !== revision) throw new Error('The candidate changed before native inspection.');
  const assets = join(workspace, '.local-tools/native-assets');
  await mkdir(assets, { recursive: true });
  const folder = receiptRoot ? await containedPath(assets, receiptRoot) : assets;
  await assertNoLinks(folder);
  const receiptPath = join(await mkdtemp(join(folder, 'review-copy-')), 'open.json');
  const drafts = platformPaths().drafts;
  await mkdir(drafts, { recursive: true });
  if ((await lstat(drafts)).isSymbolicLink()) throw new Error('Linked CapCut libraries are not supported.');
  const index = join(drafts, 'root_meta_info.json');
  if (existsSync(index) && (await lstat(index)).isSymbolicLink()) throw new Error('Linked CapCut library index.');
  const session = join(workspace, 'scripts/capcut-session.mjs');
  const run = args => runNativeCopyCommand(args, { cwd: workspace, signal });
  const projectName = `Verify ${randomInt(10000000, 100000000)}`;
  const destination = join(drafts, projectName);
  const cli = join(workspace, 'toolchain/node_modules/capcut-cli/dist/index.js');
  let metadata;
  const result = await runReviewCopy({ receiptPath, revision, projectName }, {
    close: () => run([session, 'close']),
    publish: () => run([join(workspace, 'scripts/capcut-draft.mjs'), 'publish', candidate, destination]),
    register: () => run([cli, 'register', destination, '--apply', '--materials', '--drafts', drafts,
      ...(existsSync(join(destination, 'Timelines')) ? ['--active-timeline'] : [])]),
    'link-media': () => run([join(workspace, 'scripts/capcut-draft.mjs'), 'link-media', destination]),
    identity: async () => {
      metadata = JSON.parse(await readFile(join(destination, 'draft_meta_info.json'), 'utf8'));
      if (metadata.draft_name !== projectName) throw new Error('Published project identity differs from the inspection target.');
    },
    equivalence: async () => {
      await assertPublishedEquivalent(candidate, destination);
      await writeFile(join(destination, '.ai-editor-review.json'), JSON.stringify({ kind: 'temporary-review', sourceCandidate: candidate, revision }));
    },
    open: () => run([session, 'open', destination]),
  }, signal);
  return { ...result, destination, projectId: metadata.draft_id };
}
