// Developer diagnostic: can the installed CapCut hydrate one uncached free
// resource when a disposable project references its official identity?
// Never purchases, uploads, exports or modifies an original project.
import { cp, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { loadDraft, saveDraft } from '../toolchain/node_modules/capcut-cli/dist/draft.js';
import { addEffect } from '../toolchain/node_modules/capcut-cli/dist/factory.js';
import { listEnum } from '../toolchain/node_modules/capcut-cli/dist/enums.js';
import { inspectEffectResource, selectOfficialEffect } from '../src/server/capcut/effect-resources.mjs';
import { prepareNativeCopy } from '../src/server/capcut/native-copy.mjs';
import { NativeUI } from '../src/server/capcut/native-ui.mjs';
import { directoryDigest } from '../src/server/editing/transaction.ts';
import { acquireLock } from '../src/server/editing/lock.ts';
import { containedPath, assertNoLinks } from '../src/server/security/paths.ts';
import { runCancellableProcess } from '../src/lib/cancellable-process.ts';

const root = process.cwd();
const fixture = await containedPath(join(root, '.local-tools/staging'), resolve(process.argv[2]));
await assertNoLinks(fixture);
if (!loadDraft(fixture).draft.name.startsWith('Native calibration')) throw new Error('Expected a disposable calibration fixture.');
const request = JSON.parse(await readFile(process.argv[3], 'utf8'));
const entry = listEnum('scene_effects', 'capcut').find(e => e.slug === request.slug && e.is_vip === false);
if (!entry) throw new Error('Expected a pinned free effect.');
const item = selectOfficialEffect(entry, request.items);
if (!item) throw new Error('Expected one matching official resource.');
const before = inspectEffectResource(entry, item);
if (before.available) throw new Error('Resource is already cached; this would not test download behaviour.');
const release = await acquireLock(join(root, '.local-tools/locks/editing.lock'));
const receipt = { slug: entry.slug, resourceId: item.resource_id, before, downloaded: false };
let job;
try {
  job = await mkdtemp(join(root, '.local-tools/native-assets/download-probe-'));
  const candidate = await mkdtemp(join(root, '.local-tools/staging/download-probe-'));
  await cp(fixture, candidate, { recursive: true });
  const loaded = loadDraft(candidate);
  addEffect(loaded.draft, { slug: entry.slug, resourceId: item.resource_id, effectId: item.resource_id, start: 0, duration: 3000000, intensity: 1 });
  saveDraft(candidate, loaded.draft, loaded.store);
  const published = await prepareNativeCopy(candidate, await directoryDigest(candidate));
  Object.assign(receipt, { candidate, published });
  const ui = new NativeUI(join(job, 'ui')); ui.projectOnly = true;
  let state = await ui.waitFor(published.projectName);
  if (state.words.some(w => w.text === 'Home')) {
    await ui.openProject(state, published.projectName);
    state = await ui.waitFor(published.projectName, 45000, { x: 0, y: 0, width: 10000, height: 80 * (state.scale || 1) });
  }
  receipt.capcutVersion = state.version;
  console.log('Disposable download probe opened; waiting for CapCut’s resource cache.');
  const deadline = Date.now() + 90000;
  do {
    const resource = inspectEffectResource(entry, item);
    if (resource.available) { receipt.downloaded = true; receipt.resource = resource; break; }
    await new Promise(done => setTimeout(done, 2000));
  } while (Date.now() < deadline);
} catch (error) { receipt.error = error.message; }
finally {
  try { await runCancellableProcess(process.execPath, [join(root, 'scripts/capcut-session.mjs'), 'close'], { cwd: root, timeoutMs: 60000, onLine: () => {} }); }
  catch (error) { receipt.closeError = error.message; }
  if (job) await writeFile(join(job, 'download-probe.json'), JSON.stringify(receipt, null, 2));
  await release();
}
console.log(JSON.stringify({ job, ...receipt }));
if (!receipt.downloaded || receipt.closeError) process.exitCode = 2;
