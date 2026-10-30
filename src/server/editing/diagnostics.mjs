import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { editingFailureMessage, nativeFailureCode, nativeFailureMessages, versionBoundaryMessage } from './errors.mjs';

const extractionCodes = ['CLIP_DURATION_MISMATCH', 'CLIP_EXTRACTION_FAILED', 'SOURCE_INTERVAL_EXCEEDS_MEDIA', 'CLIP_SPEED_CONFLICT'];
const nativeStages = ['preflight', 'publish', 'open', 'inspect', 'capture', 'equivalence', 'close', 'register', 'link-media', 'identity'];

/** Only controller-owned categories/counts/hashes leave the machine. Never serialize OS stderr or asset paths. */
function nativeDetails(details = {}) {
  const receipt = typeof (details.receiptPath || details.receipt) === 'string'
    ? (details.receiptPath || details.receipt).replaceAll('\\', '/').match(/(?:^|\/)((?:native-preview|review-copy)-[\w-]+\/(?:capture|open)\.json)$/)?.[1] : undefined;
  return { stage: nativeStages.includes(details.stage) ? details.stage : 'unknown',
    ...(receipt ? { receipt } : {}),
    ...(typeof details.candidateDigest === 'string' && /^[a-f\d]{64}$/.test(details.candidateDigest) ? { candidateDigest: details.candidateDigest } : {}),
    ...(Number.isInteger(details.samples) && details.samples >= 0 ? { samples: details.samples } : {}),
    ...(Number.isInteger(details.wrapperExitCode) ? { wrapperExitCode: details.wrapperExitCode } : {}),
    ...(Number.isInteger(details.launchExitCode) ? { launchExitCode: details.launchExitCode } : {}),
    ...(typeof details.published === 'boolean' ? { published: details.published } : {}),
    ...(typeof details.registered === 'boolean' ? { registered: details.registered } : {}),
    ...(Array.isArray(details.steps) ? { steps: details.steps.filter(s => nativeStages.includes(s.stage)
      && ['running', 'passed', 'failed'].includes(s.status)).slice(0, 10).map(s => ({ stage: s.stage, status: s.status })) } : {}),
    ...(details.platform === 'darwin' || details.platform === 'win32' ? { platform: details.platform } : {}) };
}

function redacted(value) {
  let result = String(value || '');
  for (const path of [process.cwd(), homedir()]) for (const spelling of [pathToFileURL(path).href, path, path.replaceAll('\\', '/')]) result = result.replaceAll(spelling, '[local]');
  return result.replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, 'Bearer [redacted]')
    .replace(/(api[_-]?key|access_token|refresh_token|authorization_code)(["'\s:=]+)[^\s",}]+/gi, '$1$2[redacted]').slice(0, 12000);
}

export function captureFailureDiagnostic(error) {
  if (error?.code === 'CAPCUT_VERSION_UNSUPPORTED' || /refused \[version-boundary\]/.test(`${error?.message || ''}\n${error?.stderr || ''}`))
    return { version: 1, stage: 'compatibility', code: 'CAPCUT_VERSION_UNSUPPORTED', message: versionBoundaryMessage,
      details: compatibilityDetails(error.compatibility) };
  const nativeCode = nativeFailureCode(error);
  if (nativeCode) return { version: 1, stage: 'native_review', code: nativeCode,
    message: nativeFailureMessages[nativeCode], details: nativeDetails(error?.nativeFailure) };
  const measured = error?.diagnostic?.stage === 'clip_extraction' && extractionCodes.includes(error.diagnostic.code)
    ? JSON.parse(JSON.stringify(error.diagnostic.details)) : undefined;
  return { version: 1, stage: measured ? 'clip_extraction' : 'editing',
    code: measured ? error.diagnostic.code : 'EDIT_FAILED', message: redacted(editingFailureMessage(error)),
    stack: redacted(error?.stack?.split(/\r?\n/).filter(line => /^\s+at /.test(line)).slice(0, 12).join('\n')),
    ...(measured ? { details: measured } : {}) };
}

/** Sharing report: prompts, media and the full job object are not exported. */
export function buildJobDiagnosticReport(job) {
  const diagnostic = job.diagnostic;
  const extraction = diagnostic?.stage === 'clip_extraction' && extractionCodes.includes(diagnostic.code);
  const native = diagnostic?.stage === 'native_review' && Object.hasOwn(nativeFailureMessages, diagnostic.code);
  const compatibility = diagnostic?.stage === 'compatibility' && diagnostic.code === 'CAPCUT_VERSION_UNSUPPORTED';
  // Generic planner/reviewer error prose can quote private requested captions.
  // Keep that prose in the local UI; exports use a classification instead.
  const message = extraction ? 'Clip preparation stopped. See the measured source and timeline timing below.'
    : native ? nativeFailureMessages[diagnostic.code] : compatibility ? versionBoundaryMessage : 'Editing stopped. The detailed error text remains in the local app.';
  const failure = diagnostic ? { version: 1, stage: extraction ? 'clip_extraction' : native ? 'native_review' : compatibility ? 'compatibility' : 'editing',
    code: extraction || native || compatibility ? diagnostic.code : 'EDIT_FAILED', message,
    stack: redacted(diagnostic.stack?.split(/\r?\n/).filter(line => /^\s+at /.test(line)).slice(0, 12).join('\n')),
    ...(extraction ? { details: diagnostic.details } : native ? { details: nativeDetails(diagnostic.details) } : compatibility ? { details: compatibilityDetails(diagnostic.details) } : {}) } : undefined;
  return { version: 1, generatedAt: new Date().toISOString(), runtime: { platform: process.platform, arch: process.arch, node: process.version },
    job: { id: job.id, status: job.status, createdAt: job.createdAt, updatedAt: job.updatedAt, ...(job.error ? { error: message } : {}) },
    failure,
    ...(job.reviewCopy ? { reviewCopy: { ...nativeDetails(job.reviewCopy),
      status: ['handoff_accepted', 'failed'].includes(job.reviewCopy.status) ? job.reviewCopy.status : 'unknown',
      projectVisible: false,
      ...(/^Verify \d{8}$/.test(job.reviewCopy.projectName) ? { projectName: job.reviewCopy.projectName } : {}) } } : {}),
    note: job.diagnostic ? 'Contains failure categories, stages and measurements. No media or prompt is included.'
      : 'Detailed timing evidence was not recorded for this older run. Retry with the updated app, then download diagnostics if preparation fails.' };
}

function compatibilityDetails(details = {}) {
  return { appVersion: /^\d+(?:\.\d+){0,3}$/.test(details?.appVersion || '') ? details.appVersion : null,
    schema: Number.isSafeInteger(details?.schema) ? details.schema : null };
}
