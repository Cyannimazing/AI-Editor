import { existsSync } from 'node:fs';
import { join } from 'node:path';

export function previewFont(platform = process.platform, env = process.env) {
  const fonts = platform === 'win32'
    ? [join(env.WINDIR || 'C:\\Windows', 'Fonts', 'arial.ttf'), join(env.WINDIR || 'C:\\Windows', 'Fonts', 'segoeui.ttf')]
    : ['/System/Library/Fonts/Supplemental/Arial.ttf', '/System/Library/Fonts/Helvetica.ttc', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'];
  const font = fonts.find(existsSync);
  if (!font) throw new Error('A local preview font is unavailable. Native text remains editable.');
  return font;
}

/** Adapt the pinned CLI proxy without changing its installed package. */
export function preparePreviewPlan(plan, draft, font) {
  if (!Array.isArray(plan.args) || !plan.args.every(arg => typeof arg === 'string') || typeof plan.filterComplex !== 'string') throw new Error('Invalid preview plan.');
  const args = [...plan.args], direct = args.indexOf('-filter_complex');
  const at = direct >= 0 ? direct : args.indexOf('-filter_complex_script');
  if (at < 0 || (direct >= 0 ? args[at + 1] !== plan.filterComplex
    : args[at + 1] !== plan.filterScript?.path || plan.filterScript?.content !== plan.filterComplex)) throw new Error('Preview graph is inconsistent.');
  let graph = plan.filterComplex;
  // Upstream sorts overlays by start time. Native tracks define stacking order;
  // a later background hold must not cover an earlier foreground graphic.
  const tracks = draft.tracks.filter(track => track.type === 'video').slice(1);
  const ordered = tracks.flatMap((track, layer) => track.segments.map(segment => ({ segment, layer })))
    .sort((a, b) => a.segment.target_timerange.start - b.segment.target_timerange.start);
  const usable = ordered.filter(({ segment }) => {
    const material = draft.materials.videos.find(item => item.id === segment.material_id);
    return material?.path && existsSync(material.path);
  });
  const pattern = /\[\d+:v\][^;]*\[ovsrc(\d+)\];\[[^\]]+\]\[ovsrc\1\]overlay=[^;]*\[ovout\1\]/g;
  const blocks = [...graph.matchAll(pattern)];
  if (blocks.length !== plan.overlaySegments || blocks.length !== usable.length) throw new Error('Preview overlay layout changed; update the pinned adapter.');
  if (blocks.length) {
    const first = blocks[0].index, last = blocks.at(-1), end = last.index + last[0].length;
    if (graph.slice(first, end).split(';').length !== blocks.length * 2) throw new Error('Unexpected preview overlay graph.');
    let previous = 'vout';
    const sorted = blocks.map((block, index) => ({ block, layer: usable[index].layer }))
      .sort((a, b) => a.layer - b.layer);
    const rebuilt = sorted.map(({ block }, index) => {
      const id = block[1], output = `preview_layer_${index}`;
      const value = block[0].replace(new RegExp(`\\[[^\\]]+\\]\\[ovsrc${id}\\]overlay=`), `[${previous}][ovsrc${id}]overlay=`)
        .replace(`[ovout${id}]`, `[${output}]`);
      previous = output;
      return value;
    }).join(';');
    graph = graph.slice(0, first) + rebuilt + graph.slice(end).replaceAll(`[ovout${last[1]}]`, `[${previous}]`);
    for (let index = 0; index < args.length; index++) if (args[index] === `[ovout${last[1]}]`) args[index] = `[${previous}]`;
  }
  if (/[\r\n'\[\];]/.test(font)) throw new Error('Unsafe preview font path.');
  const escaped = font.replaceAll('\\', '/').replaceAll(':', '\\:');
  graph = graph.replaceAll('drawtext=', `drawtext=fontfile='${escaped}':`);
  if (direct >= 0) args[at + 1] = graph;
  return { ...plan, ...(direct < 0 ? { filterScript: { ...plan.filterScript, content: graph } } : {}), filterComplex: graph, args, previewKind: 'approximate',
    limitations: ['Native effects, keyframes, text styling and compositing can differ. CapCut verification is required.'] };
}
