/** Conservative explicit prompt shortcut; ordinary editing remains unrestricted.
 * Read only the user's request, never reference OCR or resource metadata.
 */
export function editingScope(prompt) {
  return /\b(?:keyframes?\s*[- ]only|only\s+(?:the\s+)?keyframes?)\b/i.test(prompt)
    || /\b(?:no|without)\s+(?:any\s+)?effects?\s*[,;.!]?\s*(?:just|only)\s+(?:perfect\s+)?(?:the\s+)?(?:keyframes?|motion|movement)\b/i.test(prompt)
    ? 'keyframes' : 'full';
}

export function assertEditingScope(plan, scope) {
  if (scope !== 'keyframes') return;
  if (plan.audio?.clips?.length || plan.audio?.assets?.length) throw new Error('Keyframes-only request: preserve audio; remove added sound assets and clips.');
  if (plan.effects?.length || plan.resourceQueries?.length)
    throw new Error('Keyframes-only request: remove effect tracks and online material queries. Keep techniques limited to the requested motion.');
  if (plan.source.volume !== 1 || [plan.source, ...(plan.overlays || []), ...plan.texts].some(item =>
    item.keyframes.some(frame => !['scale', 'x', 'y', 'rotation', 'opacity'].includes(frame.property))))
    throw new Error('Keyframes-only request: preserve audio and remove brightness, contrast, saturation and volume animation. Focus on position, scale, rotation, timing and easing.');
}
