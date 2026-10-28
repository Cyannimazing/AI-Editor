/** Only observed player surfaces are accepted; never guess the canvas from footage colors. */
export function previewGeometry(state, width, height) {
  const scale = state.scale || 1;
  if (![width, height].every(v => Number.isFinite(v) && v > 0)) throw new Error('Invalid preview canvas.');
  const labels = state.words.filter(w => /^Player(?:-Timeline)?(?: \d+)?$/i.test(w.text));
  const candidates = (state.panels || []).filter(p => p.window !== state.window && p.width >= 200 * scale && p.height >= 120 * scale
    && p.x >= 0 && p.y >= 0 && p.x + p.width <= state.width && p.y + p.height < state.height * .8
    && labels.some(w => Math.abs(w.x - p.x) < 20 * scale && p.y > w.y && p.y - w.y < 60 * scale));
  const panels = [...new Map(candidates.map(p => [JSON.stringify([p.x, p.y, p.width, p.height]), p])).values()];
  if (panels.length !== 1) throw new Error('Cannot identify one native player viewport in this CapCut layout.');
  const panel = panels[0], ratio = width / height;
  const cw = Math.min(panel.width, panel.height * ratio), ch = cw / ratio;
  const crop = { x: Math.round(panel.x + (panel.width - cw) / 2), y: Math.round(panel.y + (panel.height - ch) / 2), width: Math.floor(cw), height: Math.floor(ch) };
  const clock = { x: Math.round(panel.x - 4 * scale), y: Math.round(panel.y + panel.height + 28 * scale), width: Math.round(180 * scale), height: Math.round(40 * scale) };
  if (clock.x < 0 || clock.y + clock.height > state.height) throw new Error('Player timecode is outside the native window.');
  return { panel, crop, clock, anchor: labels.find(w => w.text.includes('01'))?.text || labels[0].text };
}

export function playerFrame(words, clock, fps) {
  if (!Number.isInteger(fps) || fps < 1 || fps > 60) throw new Error('Unsupported player frame rate.');
  // Only the left (current) counter. The duration counter cannot establish a seek.
  const values = words.filter(w => w.x >= clock.x && w.x < clock.x + clock.width * .42 && w.y >= clock.y && w.y < clock.y + clock.height)
    .flatMap(w => {
      if (!/^[\d: .-]+$/.test(w.text)) return [];
      const digits = w.text.replace(/[: .-]/g, '');
      if (!/^\d{8}$/.test(digits)) return [];
      const [h, m, s, f] = [0, 2, 4, 6].map(i => Number(digits.slice(i, i + 2)));
      return m < 60 && s < 60 && f < fps ? [((h * 60 + m) * 60 + s) * fps + f] : [];
    });
  const unique = [...new Set(values)];
  if (unique.length !== 1) throw new Error(unique.length ? 'Player timecode is ambiguous.' : 'Cannot read the player timecode.');
  return unique[0];
}

export function previewSchedule(start, duration, fps) {
  if (![start, duration, fps].every(Number.isFinite) || start < 0 || duration <= 0 || !Number.isInteger(fps) || fps < 1 || fps > 60) throw new Error('Invalid preview interval.');
  const first = Math.round(start * fps), last = Math.ceil((start + duration) * fps) - 1;
  const step = Math.max(1, Math.ceil((last - first + 1) / 90));
  const frames = []; for (let f = first; f <= last; f += step) frames.push(f);
  return { frames, fps, sampleFps: fps / step, consecutive: step === 1 };
}

export function navigationSteps(previous, target, reset) {
  const from = reset ? 0 : previous;
  if (![from, target].every(Number.isInteger) || from < 0 || target < from || target - from > 90000) throw new Error('Invalid or excessive native frame navigation.');
  const steps = []; let expected = from;
  do {
    const frames = Math.min(1000, target - expected); expected += frames;
    steps.push({ frames, expected, reset: Boolean(reset && !steps.length) });
  } while (expected < target);
  return steps;
}
