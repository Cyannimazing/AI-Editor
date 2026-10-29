import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { editingFailureMessage } from './errors.mjs';

function redacted(value) {
  let result = String(value || '');
  for (const path of [process.cwd(), homedir()]) for (const spelling of [pathToFileURL(path).href, path, path.replaceAll('\\', '/')]) result = result.replaceAll(spelling, '[local]');
  return result.replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, 'Bearer [redacted]')
    .replace(/(api[_-]?key|access_token|refresh_token|authorization_code)(["'\s:=]+)[^\s",}]+/gi, '$1$2[redacted]').slice(0, 12000);
}

export function captureFailureDiagnostic(error) {
  const measured = error?.diagnostic?.stage === 'clip_extraction' && ['CLIP_DURATION_MISMATCH', 'CLIP_EXTRACTION_FAILED'].includes(error.diagnostic.code)
    ? JSON.parse(JSON.stringify(error.diagnostic.details)) : undefined;
  return { version: 1, stage: measured ? 'clip_extraction' : 'editing',
    code: measured ? error.diagnostic.code : 'EDIT_FAILED', message: redacted(editingFailureMessage(error)),
    stack: redacted(error?.stack?.split(/\r?\n/).filter(line => /^\s+at /.test(line)).slice(0, 12).join('\n')),
    ...(measured ? { details: measured } : {}) };
}

/** Sharing report: prompts, media and the full job object are not exported. */
export function buildJobDiagnosticReport(job) {
  const diagnostic = job.diagnostic;
  const extraction = diagnostic?.stage === 'clip_extraction' && ['CLIP_DURATION_MISMATCH', 'CLIP_EXTRACTION_FAILED'].includes(diagnostic.code);
  // Generic planner/reviewer error prose can quote private requested captions.
  // Keep that prose in the local UI; exports use a classification instead.
  const message = extraction ? 'Clip preparation stopped. See the measured source and timeline timing below.'
    : 'Editing stopped. The detailed error text remains in the local app.';
  const failure = diagnostic ? { version: 1, stage: extraction ? 'clip_extraction' : 'editing',
    code: extraction ? diagnostic.code : 'EDIT_FAILED', message,
    stack: redacted(diagnostic.stack?.split(/\r?\n/).filter(line => /^\s+at /.test(line)).slice(0, 12).join('\n')),
    ...(extraction ? { details: diagnostic.details } : {}) } : undefined;
  return { version: 1, generatedAt: new Date().toISOString(), runtime: { platform: process.platform, arch: process.arch, node: process.version },
    job: { id: job.id, status: job.status, createdAt: job.createdAt, updatedAt: job.updatedAt, ...(job.error ? { error: message } : {}) },
    failure,
    note: job.diagnostic ? 'Contains local failure and timing measurements. No media or prompt is included.'
      : 'Detailed timing evidence was not recorded for this older run. Retry with the updated app, then download diagnostics if preparation fails.' };
}
