import { existsSync, lstatSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createRequire } from 'node:module';

// Only known installed system fonts; workers never supply filesystem paths.
const families = {
  arial: { name: 'Arial', windows: ['arial.ttf'], mac: ['Arial.ttf'] },
  georgia: { name: 'Georgia', windows: ['georgia.ttf'], mac: ['Georgia.ttf'] },
  times: { name: 'Times New Roman', windows: ['times.ttf'], mac: ['Times New Roman.ttf'] },
  courier: { name: 'Courier New', windows: ['cour.ttf'], mac: ['Courier New.ttf'] },
};
const catalogs = new Map();
export function availableTextFonts(platform = process.platform, env = process.env) {
  const root = platform === 'win32' ? join(env.WINDIR || 'C:\\Windows', 'Fonts') : '/System/Library/Fonts/Supplemental';
  const roots = [root, ...(platform === 'win32' ? [join(env.LOCALAPPDATA || join(homedir(), 'AppData/Local'), 'Microsoft/Windows/Fonts')] : ['/Library/Fonts', join(homedir(), 'Library/Fonts')])].filter(existsSync);
  const fingerprint = JSON.stringify(roots.map(path => [path, lstatSync(path).mtimeMs]));
  if (catalogs.has(fingerprint)) return catalogs.get(fingerprint);
  const fonts = Object.entries(families).flatMap(([id, family]) => {
    const path = (platform === 'win32' ? family.windows : family.mac).map(file => join(root, file)).find(existsSync);
    return path ? [{ id, name: family.name, path }] : [];
  });
  const fontkit = createRequire(join(process.cwd(), 'toolchain/package.json'))('fontkit');
  const paths = new Set(fonts.map(font => font.path.toLowerCase())), ids = new Set(fonts.map(font => font.id));
  for (const folder of roots) for (const entry of readdirSync(folder, { withFileTypes: true }).slice(0, 2000)) {
    if (!entry.isFile() || !/\.(ttf|otf)$/i.test(entry.name) || fonts.length >= 600) continue;
    const path = join(folder, entry.name), metadata = lstatSync(path);
    if (!metadata.isFile() || metadata.size > 32 * 1024 * 1024 || paths.has(path.toLowerCase())) continue;
    try {
      const parsed = fontkit.openSync(path);
      const name = String(parsed.fullName || parsed.familyName || '').trim().slice(0, 100);
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64);
      const id = `font-${slug}`;
      if (!slug || ids.has(id)) continue;
      fonts.push({ id, name, path }); ids.add(id); paths.add(path.toLowerCase());
    } catch { /* Unsupported/corrupt fonts are unavailable; no download or fallback. */ }
  }
  catalogs.set(fingerprint, fonts);
  return fonts;
}
export function resolveTextFont(id) {
  const font = availableTextFonts().find(font => font.id === id);
  if (!font) throw new Error(`Requested local font is unavailable: ${id}`);
  return font;
}
