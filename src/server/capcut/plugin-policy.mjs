export const materialTypes = ['video_effect', 'face_effect', 'filter', 'transition', 'font', 'text_effect', 'text_template', 'sound_effect', 'music'];
export function materialSearchArguments(input) {
  if (!input || !materialTypes.includes(input.kind)) throw new Error('Choose a supported CapCut material category.');
  if (typeof input.query !== 'string' || !input.query.trim() || input.query.length > 500) throw new Error('Describe the material using 1–500 characters.');
  // The bridge accepts only a query; never arbitrary tool names, uploads or file paths.
  if (Object.keys(input).some(key => !['query', 'kind'].includes(key))) throw new Error('Unexpected material-search parameters.');
  return { type: input.kind, prompt: input.query.trim(), top_n: 5 };
}
export function capcutAuthorizationUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== 'www.capcut.com' || url.username || url.password || url.port || !url.pathname.startsWith('/api/external_mcp/oauth/')) throw new Error('Codex returned an unexpected CapCut authorization destination.');
  return url.href;
}
export function materialSearchTool(tools) {
  const matches = Object.values(tools || {}).filter(tool => tool.name === 'search_capcut_material' || tool.name.endsWith('__search_capcut_material'));
  if (matches.length !== 1) throw new Error('The official CapCut material-search tool is unavailable. Recheck the connection; no replacement tool was called.');
  const tool = matches[0];
  if (tool.annotations?.destructiveHint === true || tool.annotations?.readOnlyHint === false) throw new Error('The available CapCut tool is not approved as a read-only material search.');
  const properties = tool.inputSchema?.properties;
  if (!properties?.type || !properties?.prompt) throw new Error('The installed CapCut search contract changed. Update its adapter before use.');
  return tool.name;
}

export function materialSearchItems(result) {
  const candidates = [result.structuredContent];
  for (const block of result.content || []) if (block.type === 'text' && typeof block.text === 'string') {
    try { candidates.push(JSON.parse(block.text)); } catch { /* Only the documented JSON result is data. */ }
  }
  for (const candidate of candidates) {
    const items = candidate?.items || candidate?.data?.items || candidate?.result?.items;
    if (!Array.isArray(items)) continue;
    return items.slice(0, 20).map(item => {
      if (!item || typeof item !== 'object') throw new Error('CapCut returned an invalid material item.');
      return Object.fromEntries(['resource_id', 'stdraft_uri', 'title', 'name', 'author', 'duration_ms', 'description', 'is_vip'].filter(key => Object.hasOwn(item, key)).map(key => [key, item[key]]));
    });
  }
  throw new Error('CapCut returned an unfamiliar material-search result. No resource was applied.');
}
