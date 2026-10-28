import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
const run = promisify(execFile), root = process.cwd();
const names = [...new Set((await run('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { maxBuffer: 10_000_000 })).stdout.split('\0').filter(Boolean))].sort();
const files = [];
for (const path of names) {
  try { files.push({ path, sha256: createHash('sha256').update(await readFile(join(root, path))).digest('hex') }); }
  catch (error) { if (error.code !== 'ENOENT') throw error; files.push({ path, deleted: true }); }
}
const folder = join(root, '.local-tools', 'preview-probe'); await mkdir(folder, { recursive: true });
const evidenceNames = ['audit-final-tests.log', 'motion-tests-final.log', 'audit-final-lint.log', 'audit-final-build.log',
  'app-dependency-audit.json', 'toolchain-dependency-audit.json', 'audit-worker-denial.log', 'audit-http-security.json', 'project-scope-smoke.log', 'audit-doctor.json'];
const evidence = [];
for (const path of evidenceNames) evidence.push({ path, sha256: createHash('sha256').update(await readFile(join(folder, path))).digest('hex') });
const manifest = { createdAt: new Date().toISOString(), platform: process.platform, arch: process.arch, node: process.version,
  baseCommit: (await run('git', ['rev-parse', 'HEAD'])).stdout.trim(),
  sourceDigest: createHash('sha256').update(JSON.stringify(files)).digest('hex'), files, evidence,
  note: 'Identifies source and recorded evidence; does not turn a log into a passing result or certify native Mac acceptance.' };
await writeFile(join(folder, 'audit-verification-manifest.json'), JSON.stringify(manifest, null, 2));
console.log(JSON.stringify({ sourceDigest: manifest.sourceDigest, files: files.length, evidence: evidence.length }));
