import { join } from 'node:path';
import { homedir } from 'node:os';

export const structuredDisabledFeatures = [
  'shell_tool', 'unified_exec', 'apps', 'plugins', 'remote_plugin', 'browser_use',
  'browser_use_external', 'computer_use', 'skill_mcp_dependency_install', 'skill_search',
  'view_image', 'code_mode', 'code_mode_host', 'code_mode_only', 'memories', 'multi_agent',
  'workspace_dependencies', 'request_permissions_tool',
  'image_generation', 'goals',
];

/** The model proposes JSON. Only trusted application code performs edits. */
export function structuredPolicyArgs(cwd, platform = process.platform, localMcp = false) {
  const filesystem = { ':minimal': 'read', [cwd]: 'read',
    [process.env.CODEX_HOME || join(homedir(), '.codex')]: 'deny' };
  const table = '{' + Object.entries(filesystem).map(([key, value]) => `${JSON.stringify(key.replaceAll('\\', '/'))}=${JSON.stringify(value)}`).join(',') + '}';
  const shellQuote = value => "'" + value.replaceAll("'", "'\\''") + "'";
  const windowsQuote = value => { if (/["%\r\n]/.test(value)) throw new Error('Unsupported hook command path.'); return `"${value}"`; };
  const hookPath = join(process.cwd(), 'scripts', 'editing-tool-hook.mjs');
  const command = localMcp ? `${shellQuote(process.execPath)} ${shellQuote(hookPath)}` : "/bin/sh -c 'exit 2'";
  const windowsCommand = localMcp ? `${windowsQuote(process.execPath)} ${windowsQuote(hookPath)}` : 'cmd.exe /d /c exit /b 2';
  const hook = `{matcher=".*",hooks=[{type="command",command=${JSON.stringify(command)},command_windows=${JSON.stringify(windowsCommand)},timeout=5}]}`;
  return [
    ...structuredDisabledFeatures.filter(feature => !localMcp || feature !== 'code_mode_host').flatMap(feature => ['--disable', feature]),
    ...(localMcp ? ['--enable', 'code_mode_host'] : []),
    '--enable', 'hooks', '--config', `hooks.PreToolUse=[${hook}]`,
    '--config', 'web_search="disabled"', '--config', 'approval_policy="never"',
    '--config', 'project_doc_max_bytes=0', '--disable', 'shell_snapshot',
    '--config', 'default_permissions="ai_editor_plan"', '--config', `permissions.ai_editor_plan.filesystem=${table}`,
    '--config', 'permissions.ai_editor_plan.network.enabled=false',
    ...(platform === 'win32' ? ['--config', 'windows.sandbox="mxc"'] : []),
  ];
}
