import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { findExecutable } from '../platform/runtime.mjs';
import { motionPython } from '../editing/motion-runtime.mjs';

export function capcutPluginRoots(codexHome = process.env.CODEX_HOME || join(homedir(), '.codex')) {
  return [join(codexHome, 'plugin-marketplaces/CapCut/codex'), join(codexHome, 'plugins/cache/CapCut/CapCut/0.2.6')];
}

export function installedCapcutPlugin(codexHome) {
  return capcutPluginRoots(codexHome).find(root => {
    try {
      const metadata = JSON.parse(readFileSync(join(root, '.codex-plugin/plugin.json'), 'utf8'));
      return metadata.name === 'CapCut' && metadata.version === '0.2.6'
        && ['apply_materials.py', 'manage_materials.py'].every(file => existsSync(join(root, 'skills/capcut-stdraft-builder/scripts', file)));
    } catch { return false; }
  }) || null;
}

/** Installation/runtime preflight, separate from authorization and playback. */
export function localEffectBuilder() {
  const root = installedCapcutPlugin();
  if (!root) return { available: false, reason: 'The compatible official CapCut local builder is not installed.' };
  const python = existsSync(motionPython()) ? motionPython() : findExecutable(process.platform === 'win32' ? 'python' : 'python3');
  if (!python) return { available: false, reason: 'Python 3 is required for the official CapCut local editing functions.' };
  return { available: true, root, python, version: '0.2.6' };
}
