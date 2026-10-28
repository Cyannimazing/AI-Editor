// Exercise the same resource-acquisition service used by application jobs.
import { copyFile, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { listEnum } from '../toolchain/node_modules/capcut-cli/dist/enums.js';
import { selectOfficialEffect } from '../src/server/capcut/effect-resources.mjs';
import { acquireEffectResources } from '../src/server/capcut/effect-acquisition.mjs';
import { acquireLock } from '../src/server/editing/lock.ts';
import { containedPath, assertNoLinks } from '../src/server/security/paths.ts';
const root = process.cwd();
const fixture = await containedPath(join(root, '.local-tools/native-assets'), resolve(process.argv[2]));
await assertNoLinks(fixture);
const original = JSON.parse(await readFile(join(fixture, 'original-draft.json'), 'utf8'));
if (!original.name.startsWith('Native calibration')) throw new Error('Expected generated calibration metadata.');
const request = JSON.parse(await readFile(process.argv[3], 'utf8'));
const entry = listEnum('scene_effects', 'capcut').find(e => e.slug === request.slug && e.is_vip === false);
if (!entry) throw new Error('Expected a pinned free effect.');
const item = selectOfficialEffect(entry, request.items);
if (!item) throw new Error('Expected a matching official resource.');
const release = await acquireLock(join(root, '.local-tools/locks/editing.lock'));
try {
  const job = await mkdtemp(join(root, '.local-tools/native-assets/acquisition-smoke-'));
  await copyFile(join(fixture, 'original-draft.json'), join(job, 'original-draft.json'));
  const resources = await acquireEffectResources({ job, requests: [{ entry, item }], onLog: console.log });
  await writeFile(join(job, 'result.json'), JSON.stringify(resources));
  console.log(JSON.stringify({ job, resources }));
  if (!resources?.every(resource => resource.available)) process.exitCode = 2;
} finally { await release(); }
