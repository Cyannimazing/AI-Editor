/** The adapter maps relative type units using the short canvas dimension. Keep this mapping
 * in one place; browser CSS pixels must never come from the planner's intent.
 * Glyph metrics/font substitution still require version-bound native evidence.
 */
function unitPixels(width, height) {
  if (![width, height].every(value => Number.isFinite(value) && value > 0)) throw new Error('Invalid text canvas.');
  return Math.min(width, height) / 100;
}
export const pixelsToNativeTextSize = (pixels, width, height) => pixels / unitPixels(width, height);
export const nativeTextSizeToPixels = (size, width, height) => size * unitPixels(width, height);

export function readNativeText(material, width, height) {
  if (!material || typeof material.content !== 'string') throw new Error('Native text material is missing.');
  const content = JSON.parse(material.content);
  if (typeof content.text !== 'string' || !Array.isArray(content.styles) || content.styles.length !== 1)
    throw new Error('Preview does not support this native text style layout.');
  const style = content.styles[0];
  if (!(Number.isFinite(style.size) && style.size > 0) || Math.abs(style.size - material.font_size) > 1e-6)
    throw new Error('Native text size fields disagree.');
  const rgb = style.fill?.content?.solid?.color;
  if (!Array.isArray(rgb) || rgb.length !== 3 || rgb.some(value => !Number.isFinite(value) || value < 0 || value > 1))
    throw new Error('Native text color cannot be reproduced.');
  return { text: content.text, fontSize: nativeTextSizeToPixels(style.size, width, height),
    color: `#${rgb.map(value => Math.round(value * 255).toString(16).padStart(2, '0')).join('')}`,
    bold: Boolean(style.bold), italic: Boolean(style.italic), fontPath: style.font?.path || material.font_path || '' };
}
