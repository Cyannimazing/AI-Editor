/** Keep media and large tool payloads out of text progress. The model receives
 * them through MCP; this is only the CLI's diagnostic event stream. */
export function processEventLine(line) {
  if (!line.trimStart().startsWith('{')) return line;
  let event; try { event = JSON.parse(line); } catch { return line; }
  if (event.item?.type !== 'mcp_tool_call') return line;
  function sanitize(value, key = '', parent, depth = 0) {
    if (depth > 16) return '[Deep tool payload omitted]';
    if (key === 'data' && ['image', 'audio'].includes(parent?.type)) return '[media omitted from text log]';
    if (key === 'arguments' && JSON.stringify(value).length > 4000) return { omitted: 'Large arguments retained in job plan/build artifacts.' };
    if (key === 'text' && typeof value === 'string') {
      // Codex may wrap the MCP content array in a JSON text block. Sanitize
      // that envelope before truncation; otherwise the PNG prefix leaks out.
      if (/^\s*[{[]/.test(value)) {
        try { value = JSON.stringify(sanitize(JSON.parse(value), '', undefined, depth + 1)); }
        catch { /* Ordinary tool prose is bounded below. */ }
      }
      return value.length > 4000 ? value.slice(0, 4000) + '\n[Long tool result omitted from progress; inspect job evidence.]' : value;
    }
    if (Array.isArray(value)) return value.map(item => sanitize(item, '', value, depth + 1));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, sanitize(item, name, value, depth + 1)]));
    return value;
  }
  return JSON.stringify(sanitize(event));
}
