import { join } from 'node:path';
export function editingMcpArgs(job, role, root = process.cwd(), node = process.execPath) {
  const tools = ['inspect_job', 'discover_capabilities', 'reference_frames', 'evaluate_keyframes', 'inspect_timeline', ...(role === 'editor' ? ['apply_edit_plan'] : [])];
  const quote = value => JSON.stringify(value.replaceAll('\\', '/'));
  return ['--config', `mcp_servers.ai_editor={command=${quote(node)},args=[${[join(root, 'scripts/editing-mcp-server.mjs'), job, role].map(quote).join(',')}],cwd=${quote(root)},required=true,startup_timeout_sec=30,tool_timeout_sec=180,default_tools_approval_mode="auto",enabled_tools=${JSON.stringify(tools)}}`];
}
