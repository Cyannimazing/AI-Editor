/** Explicit ownership prevents catalog discovery being reported as an applied edit. */
export function integrationCapabilities({ materialSearch, localBuilder }) {
  return { version: 1, strategy: 'official-plugin-first-with-local-desktop-adapter',
    discovery: materialSearch ? 'official-capcut-plugin' : 'installed-local-catalog',
    effectBuilder: localBuilder ? 'official-capcut-local-builder' : 'unavailable',
    desktopWriter: 'validated-local-desktop-adapter',
    verification: 'saved-files-and-native-player', autoExport: false, uploads: false, paidServices: false,
    boundaries: ['Official STDraft is not a native desktop draft.', 'A catalog match does not install a desktop effect bundle.',
      'Text, media and keyframes use the desktop adapter until their official-to-desktop mappings are validated.'] };
}

export function effectRoutingReceipt(effects, bindings, capabilities) {
  return { ...capabilities, effects: effects.map((effect, index) => {
    const binding = bindings.find(b => b.index === index);
    return { index, slug: effect.slug, target: effect.target, start: effect.start, duration: effect.duration,
      provider: binding ? 'official-capcut-local-builder-and-desktop-adapter' : 'local-desktop-adapter',
      resourceId: binding?.resourceId || null, controlsVerified: binding?.controlsVerified === true,
      resourceFiles: binding?.resourceFiles?.length || 0,
      reason: binding ? binding.controlsVerified ? 'Official builder receipt and local native controls checked.' : 'Official segment prepared; compatible local resources are missing.'
        : 'No unambiguous usable official binding; local catalog path remains separately subject to resource and visual checks.',
      playbackVerified: false };
  }) };
}
