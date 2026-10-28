/** Evaluate the actual serialized native curve, including its Bezier handles. */
export function nativeCurveValue(frames, timeUs, fallback) {
  if (!frames?.length) return fallback;
  if (timeUs <= frames[0].time_offset) return frames[0].values[0];
  const right = frames.findIndex(frame => frame.time_offset > timeUs);
  if (right < 0) return frames.at(-1).values[0];
  const a = frames[right - 1], b = frames[right], span = b.time_offset - a.time_offset;
  const progress = (timeUs - a.time_offset) / span;
  if (!a.right_control?.x && !a.right_control?.y && !b.left_control?.x && !b.left_control?.y) return a.values[0] + (b.values[0] - a.values[0]) * progress;
  const bezier = (p0, p1, p2, p3, t) => (1 - t) ** 3 * p0 + 3 * (1 - t) ** 2 * t * p1 + 3 * (1 - t) * t ** 2 * p2 + t ** 3 * p3;
  let low = 0, high = 1;
  for (let i = 0; i < 32; i++) {
    const t = (low + high) / 2;
    if (bezier(a.time_offset, a.time_offset + (a.right_control?.x || 0), b.time_offset + (b.left_control?.x || 0), b.time_offset, t) < timeUs) low = t;
    else high = t;
  }
  return bezier(a.values[0], a.values[0] + (a.right_control?.y || 0), b.values[0] + (b.left_control?.y || 0), b.values[0], (low + high) / 2);
}

export function nativePose(segment, seconds, width, height) {
  const clip = segment.clip || {};
  const value = (property, fallback) => nativeCurveValue(segment.common_keyframes?.find(item => item.property_type === property)?.keyframe_list, seconds * 1e6, fallback);
  const uniform = value('UNIFORM_SCALE', undefined);
  return { x: value('KFTypePositionX', clip.transform?.x || 0) * width / 2, y: -value('KFTypePositionY', clip.transform?.y || 0) * height / 2,
    scaleX: value('KFTypeScaleX', uniform ?? clip.scale?.x ?? 1), scaleY: value('KFTypeScaleY', uniform ?? clip.scale?.y ?? 1),
    rotation: value('KFTypeRotation', clip.rotation || 0), opacity: value('KFTypeAlpha', clip.alpha ?? 1),
    brightness: value('KFTypeBrightness', 0), contrast: value('KFTypeContrast', 0), saturation: value('KFTypeSaturation', 0),
  };
}

const escapeHtml = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const safeJson = value => JSON.stringify(value).replaceAll('<', '\\u003c').replaceAll('>', '\\u003e').replaceAll('&', '\\u0026');

/** Trusted template only: model-authored HTML or JS is never executed. */
export function motionComposition(layers, { width, height, duration, fps }) {
  if (layers.some(layer => layer.font && !/^[a-z][a-z0-9-]{0,79}$/.test(layer.font))) throw new Error('Invalid preview font family.');
  const animations = [];
  const elements = layers.map((layer, index) => {
    const { segment } = layer;
    const start = layer.start, length = segment.target_timerange.duration / 1e6;
    const timing = `id="clip-${index}" data-start="${start}" data-duration="${length}" data-track-index="${index}"`;
    const fit = layer.kind === 'text' ? 1 : Math.min(width / layer.width, height / layer.height);
    const body = layer.kind === 'text'
      ? `<div ${timing} style="font-family:${layer.font ? `Local_${escapeHtml(layer.font)}` : 'PreviewLocal'};font-size:${layer.fontSize}px;font-weight:${layer.bold ? 700 : 400};font-style:${layer.italic ? 'italic' : 'normal'};color:${escapeHtml(layer.color)};white-space:pre-wrap;text-align:center;line-height:1.2;max-width:${width * 0.82}px">${escapeHtml(layer.text)}</div>`
      : layer.kind === 'photo' ? `<img ${timing} src="${escapeHtml(layer.file)}" style="width:${layer.width * fit}px;height:${layer.height * fit}px">`
        : `<video ${timing} data-media-start="${(segment.source_timerange?.start || 0) / 1e6}" src="${escapeHtml(layer.file)}" muted playsinline style="width:${layer.width * fit}px;height:${layer.height * fit}px"></video>`;
    const samples = [];
    const count = Math.ceil(length * fps);
    for (let frame = 0; frame <= count; frame++) {
      const time = Math.min(length, frame / fps);
      const { brightness, contrast, saturation, ...pose } = nativePose(segment, time, width, height);
      samples.push({ time: start + time, pose: { ...pose, filter: `brightness(${Math.max(0, 1 + brightness)}) contrast(${Math.max(0, 1 + contrast)}) saturate(${Math.max(0, 1 + saturation)})` } });
    }
    animations.push({ id: `#motion-${index}`, samples });
    return `<div class="anchor" style="z-index:${index};mix-blend-mode:${escapeHtml(layer.blendMode || 'normal')}"><div id="motion-${index}" class="motion">${body}</div></div>`;
  }).join('\n');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:PreviewLocal;src:url('font.ttf')}html,body{margin:0;padding:0;width:${width}px;height:${height}px;overflow:hidden;background:black}
${[...new Set(layers.map(layer => layer.font).filter(Boolean))].map(font => `@font-face{font-family:Local_${font};src:url('${font}.ttf')}`).join('\n')}
#composition{position:relative;width:${width}px;height:${height}px;overflow:hidden;font-family:PreviewLocal,sans-serif}.anchor{position:absolute;left:50%;top:50%;width:0;height:0}.motion{position:absolute;transform:translate(-50%,-50%);transform-origin:center center;width:max-content}img,video{display:block}
</style></head><body><div id="composition" data-composition-id="native-motion" data-start="0" data-duration="${duration}" data-width="${width}" data-height="${height}" data-fps="${fps}">${elements}</div>
<script src="gsap.min.js"></script><script>
const tl=gsap.timeline({paused:true});
// Initialize every layer before visibility rounding can reveal it. Native
// microsecond starts can lie a fraction after the browser's exact frame time.
for(const item of ${safeJson(animations)}){const first=item.samples[0];tl.set(item.id,{xPercent:-50,yPercent:-50,...first.pose},Math.min(0,first.time));for(let i=1;i<item.samples.length;i++){const a=item.samples[i-1],b=item.samples[i];tl.to(item.id,{...b.pose,duration:b.time-a.time,ease:'none'},a.time);}}
window.__timelines={'native-motion':tl};
</script></body></html>`;
}
