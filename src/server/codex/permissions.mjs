import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { mediaTool } from '../platform/runtime.mjs';

export function workerPermissionArgs(cwd, candidate, write) {
  const permission = write ? 'write' : 'read';
  const files = {
    ':minimal': 'read', ':tmpdir': 'deny', ':slash_tmp': 'deny',
    [cwd]: permission,
    [join(process.cwd(), 'toolchain')]: 'read',
    [join(process.cwd(), 'scripts')]: 'read',
    [join(process.cwd(), 'ai')]: 'read',
    [dirname(process.execPath)]: 'read',
    [dirname(mediaTool('ffmpeg'))]: 'read',
    [dirname(mediaTool('ffprobe'))]: 'read',
    [process.env.CODEX_HOME || join(homedir(), '.codex')]: 'deny',
  };
  if (process.platform === 'win32') {
    if (process.env.SystemRoot) files[process.env.SystemRoot] = 'read';
  }
  if (candidate) files[candidate] = permission;
  const table = '{' + Object.entries(files).map(([key, value]) => `${JSON.stringify(key.replaceAll('\\', '/'))}=${JSON.stringify(value)}`).join(',') + '}';
  return ['--config', 'default_permissions="ai_editor"', '--config', `permissions.ai_editor.filesystem=${table}`,
    '--config', 'permissions.ai_editor.network.enabled=false', '--config', 'approval_policy="never"',
    '--config', 'shell_environment_policy.inherit="none"', '--config', 'windows.sandbox="mxc"'];
}
