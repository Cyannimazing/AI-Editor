/** Adapt pinned CLI contracts without modifying node_modules. */
export function writeMotionCurves(draft, operations, refs, addKeyframes) {
  const grouped = new Map();
  for (const operation of operations) {
    if (operation.op !== 'keyframe') throw new Error('Unexpected native motion operation.');
    const id = refs[operation.target];
    if (!id) throw new Error(`Missing motion target: ${operation.target}`);
    const frames = grouped.get(id) || [];
    frames.push({ property: operation.property, timeUs: Math.round(operation.time * 1e6), value: operation.value, easing: operation.easing });
    grouped.set(id, frames);
  }
  const receipts = [];
  for (const [id, frames] of grouped) {
    // The CLI resolves holds only after all neighbours in this call exist.
    const segment = draft.tracks.flatMap(track => track.segments).find(segment => segment.id === id);
    if (!segment || segment.common_keyframes?.length) throw new Error('Motion must be written to a fresh compiled segment.');
    const ordered = frames.sort((a, b) => a.timeUs - b.timeUs);
    // Native curves retain their last value to the segment end. A terminal
    // hold has no outgoing interval and needs no synthetic neighbour.
    const terminalHolds = ordered.filter(frame => frame.easing === 'hold' && !ordered.some(next => next.property === frame.property && next.timeUs > frame.timeUs));
    const result = addKeyframes(draft, id, ordered.map(frame => terminalHolds.includes(frame) ? { ...frame, easing: 'linear' } : frame));
    const unresolvedHolds = result.warnings.filter(warning => warning.includes('has no later keyframe'));
    if (unresolvedHolds.length) throw new Error(`Incomplete hold curve: ${unresolvedHolds.join('; ')}`);
    receipts.push({ ...result, terminalHolds: terminalHolds.length, operation: 'native.keyframes.batch' });
  }
  return receipts;
}

/** CapCut 9.6 on Windows ignores video opacity curves unless Blend is enabled.
 * Observed by toggling Blend on a disposable native fixture: check_flag 7 -> 15.
 * Preserve all unrelated material flags; this is a bit field, not a preset.
 */
export function enableNativeCompositing(draft, segmentId) {
  const segment = draft.tracks.flatMap(track => track.segments).find(segment => segment.id === segmentId);
  if (!segment) throw new Error('Missing native compositing segment.');
  const material = draft.materials.videos?.find(item => item.id === segment.material_id);
  if (!material) return; // Text opacity uses the native text component instead.
  const previous = material.check_flag ?? 7;
  if (!Number.isSafeInteger(previous) || previous < 0 || previous > 0x7fffffff) throw new Error('Unsupported native material flags.');
  material.check_flag = previous | 8;
  return { operation: 'native.compositing.enable', segmentId, materialId: material.id, before: previous, after: material.check_flag };
}

export function writeCatalogEffect(draft, effect, target, trackName, { findEnum, addEffect }, officialBinding) {
  const composite = effect.target === 'composition';
  if (!composite && !target) throw new Error('Missing native effect target.');
  const scene = findEnum('scene_effects', effect.slug);
  const entry = scene || findEnum('character_effects', effect.slug);
  if (!entry || entry.is_vip !== false) throw new Error(`A verified no-cost catalog entry is required for ${effect.slug}.`);
  if (officialBinding && (officialBinding.slug !== effect.slug || officialBinding.source !== `vimo://${officialBinding.resourceId}`
    || !/^\d{5,24}$/.test(officialBinding.resourceId) || officialBinding.effectId !== officialBinding.resourceId || !Array.isArray(officialBinding.controls))) throw new Error('Invalid official native-effect binding.');
  const resourceId = officialBinding?.resourceId || entry.resource_id, effectId = officialBinding?.effectId || entry.effect_id;
  const result = addEffect(draft, { slug: effect.slug, start: Math.round(effect.start * 1e6), duration: Math.round(effect.duration * 1e6),
    intensity: effect.intensity, params: officialBinding ? [] : effect.params, ...(composite ? {} : { bindSegmentId: target }), trackName,
    // The CLI's inline starter catalog takes precedence over enums. Pin the
    // exact reviewed scene resource; do not validate one ID and write another.
    ...(scene ? { resourceId, effectId } : {}) });
  const material = draft.materials.video_effects.find(item => item.id === result.materialId);
  if (!scene && officialBinding) { material.resource_id = resourceId; material.effect_id = effectId; }
  if (material?.resource_id !== resourceId || material?.effect_id !== effectId) throw new Error('Native effect resource identity changed during compilation.');
  if (officialBinding) {
    for (const control of officialBinding.controls) if (!/^effects_adjust_[a-z0-9_]{1,80}$/.test(control.name)
      || !Number.isFinite(control.value) || !Number.isFinite(control.default_value)) throw new Error('Invalid named native effect value.');
    material.adjust_params = structuredClone(officialBinding.controls);
    if (officialBinding.localPath) material.path = officialBinding.localPath;
    material.name = entry.name;
  }
  return { ...result, operation: 'native.effect', slug: effect.slug, resourceId, scope: composite ? 'composition' : 'segment',
    effectId, catalogFree: true, pluginApplied: Boolean(officialBinding), controls: material.adjust_params, nativePlaybackVerified: false };
}

/** A global optical treatment may not spill onto an unrelated original layer. */
export function assertCompositeEffectScope(effects, original, selectedId) {
  const selected = original.tracks.flatMap(t => t.segments || []).find(s => s.id === selectedId);
  if (selectedId && !selected) throw new Error('Missing selected segment for effect scope.');
  const offset = selected?.target_timerange.start || 0;
  for (const effect of effects.filter(e => e.target === 'composition')) {
    const start = offset + Math.round(effect.start * 1e6), end = start + Math.round(effect.duration * 1e6);
    const unrelated = original.tracks.filter(t => t.type !== 'audio').flatMap(t => t.segments || []).some(s => s.id !== selectedId &&
      s.target_timerange.start < end && s.target_timerange.start + s.target_timerange.duration > start);
    if (unrelated) throw new Error('Composition effect overlaps unrelated original content. Use isolated layer controls or a separate candidate composition.');
  }
}
