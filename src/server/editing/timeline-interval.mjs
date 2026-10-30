/** Include adjacent transition inputs because they affect pixels at the interval edge. */
export function intervalTracks(draft, interval) {
  if (!Number.isFinite(interval?.start) || interval.start < 0 || !Number.isFinite(interval.duration) || interval.duration <= 0) throw new Error('Invalid review interval.');
  const start = Math.round(interval.start * 1e6), end = start + Math.round(interval.duration * 1e6);
  const transitions = new Set((draft.materials.transitions || []).map(item => item.id));
  return draft.tracks.map(track => {
    const included = new Set(track.segments.flatMap((segment, index) => {
      const range = segment.target_timerange;
      return range && range.start < end && range.start + range.duration > start ? [index] : [];
    }));
    // A transition attached to the outgoing clip also renders its following clip.
    let changed;
    do {
      const before = included.size;
      track.segments.forEach((segment, index) => {
        if (segment.extra_material_refs?.some(id => transitions.has(id)) && (included.has(index) || included.has(index + 1))) {
          included.add(index); if (track.segments[index + 1]) included.add(index + 1);
        }
      });
      changed = included.size !== before;
    } while (changed);
    return { ...track, segments: track.segments.filter((_, index) => included.has(index)) };
  }).filter(track => track.segments.length);
}
