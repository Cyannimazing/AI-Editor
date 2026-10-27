import { createHash } from 'node:crypto';
import { readFile, access } from 'node:fs/promises';
import { join } from 'node:path';

export async function toolchainFingerprint(root = process.cwd()) {
  const hash = createHash('sha256').update(`${process.platform}/${process.arch}/${process.versions.node.split('.')[0]}`);
  for (const file of ['package.json', 'pnpm-lock.yaml', 'patches/hyperframes@0.8.193.patch']) hash.update(await readFile(join(root, 'toolchain', file)));
  return hash.digest('hex');
}

export async function toolchainPackagesPresent(root = process.cwd()) {
  try {
    const declared = JSON.parse(await readFile(join(root, 'toolchain/package.json'), 'utf8'));
    for (const [name, version] of Object.entries({ ...declared.dependencies, ...declared.devDependencies })) {
      const installed = JSON.parse(await readFile(join(root, 'toolchain/node_modules', name, 'package.json'), 'utf8'));
      if (installed.version !== version) return false;
    }
    for (const file of ['capcut-cli/dist/index.js', 'hyperframes/bin/hyperframes.mjs', '@remotion/cli/remotion-cli.js', '@modelcontextprotocol/sdk/dist/esm/server/index.js']) await access(join(root, 'toolchain/node_modules', file));
    return true;
  } catch { return false; }
}

export async function toolchainCurrent(root = process.cwd()) {
  try {
    const receipt = JSON.parse(await readFile(join(root, '.local-tools/toolchain-receipt.json'), 'utf8'));
    return receipt.fingerprint === await toolchainFingerprint(root) && await toolchainPackagesPresent(root);
  } catch { return false; }
}
