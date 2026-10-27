import { Server } from '../toolchain/node_modules/@modelcontextprotocol/sdk/dist/esm/server/index.js';
import { StdioServerTransport } from '../toolchain/node_modules/@modelcontextprotocol/sdk/dist/esm/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '../toolchain/node_modules/@modelcontextprotocol/sdk/dist/esm/types.js';
import { createLocalEditingSession } from '../src/server/editing/local-mcp.mjs';
import { editingToolFailure } from '../src/server/editing/tool-recovery.mjs';
const [job, role] = process.argv.slice(2);
const abort = new AbortController();
const session = await createLocalEditingSession({ root: process.cwd(), job, role, signal: abort.signal });
const server = new Server({ name: 'ai-editor-local', version: '1.0.0' }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: session.tools }));
server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
  try { return await session.call(params.name, params.arguments); }
  catch (error) { return { isError: true, content: [{ type: 'text', text: JSON.stringify(editingToolFailure(error)) }] }; }
});
process.stdin.on('end', () => abort.abort());
process.on('SIGTERM', () => { abort.abort(); void server.close(); });
await server.connect(new StdioServerTransport());
