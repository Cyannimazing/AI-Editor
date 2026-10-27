import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export const setupInputs = ['toolchain/package.json', 'toolchain/pnpm-lock.yaml', 'toolchain/motion-requirements.txt',
    'toolchain/patches/hyperframes@0.8.193.patch', 'scripts/bootstrap-tools.mjs', 'scripts/prepare-toolchain.mjs', 'scripts/setup-motion-analysis.mjs', 'scripts/setup-preview-browser.mjs',
    'src/server/setup/toolchain.mjs', 'src/server/platform/runtime.mjs', 'src/server/platform/browser.mjs', 'src/server/editing/motion-runtime.mjs'];
export async function setupFingerprint(root = process.cwd(), platform = process.platform, arch = process.arch) {
  const hash = createHash('sha256').update(`${platform}/${arch}/${process.versions.node.split('.')[0]}`);
  // These are installed source-checkout files, not server bundle dependencies.
  // Avoid tracing private local media/downloads alongside the setup inputs.
  for (const file of setupInputs) hash.update(file).update(await readFile(/* turbopackIgnore: true */ join(/* turbopackIgnore: true */ root, file)));
  return hash.digest('hex');
}

export async function setupReceiptCurrent(root = process.cwd()) {
  try {
    const receipt = JSON.parse(await readFile(join(root, '.local-tools/setup-receipt.json'), 'utf8'));
    return receipt.fingerprint === await setupFingerprint(root);
  } catch { return false; }
}

export function setupView({ state, signedIn, accountError, toolsReady, receiptCurrent, running, hostReady }) {
  if (!signedIn) return { stage: 'login', progress: 0, detail: 'Sign in with ChatGPT to enable Codex editing', error: accountError || null };
  if (!hostReady) return { stage: 'error', progress: 0, detail: 'Codex local tool host needs setup', error: 'Update the official Codex app/CLI so its bundled tool host is available for MCP editing.' };
  if (running) return state;
  if (state.stage === 'error') return state;
  if (toolsReady && receiptCurrent) return { stage: 'ready', progress: 100, detail: 'Local tools are ready', error: null };
  return { stage: 'idle', progress: 0, detail: 'Preparing and checking local editing tools', error: null };
}
