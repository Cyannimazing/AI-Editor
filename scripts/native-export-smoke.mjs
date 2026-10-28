// Runs the same controller capture used by the app, against a disposable job.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { captureNativeCandidate } from '../src/server/capcut/native-capture.mjs';
import { acquireLock } from '../src/server/editing/lock.ts';
const id = process.argv[2];
if (!/^[a-f0-9-]{36}$/.test(id || '')) throw new Error('Pass a completed disposable edit job ID.');
const record = JSON.parse(await readFile(join('.local-tools/run-logs', `${id}.status.json`), 'utf8'));
if (!record.result?.projectName?.startsWith('AI Editor test')) throw new Error('This smoke accepts only disposable AI Editor test projects.');
const spec = JSON.parse(await readFile(join(record.result.jobPath, 'spec.json'), 'utf8'));
const release = await acquireLock(join('.local-tools/locks', 'editing.lock'));
try {
  const evidence = await captureNativeCandidate({ job: record.result.jobPath, candidate: record.result.candidatePath, revision: record.result.candidateDigest,
    start: spec.source.start || 0, duration: spec.source.duration, width: spec.source.width, height: spec.source.height, onLog: console.log });
  console.log(JSON.stringify(evidence));
} finally { await release(); }
