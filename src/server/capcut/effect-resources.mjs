import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { basename, isAbsolute, join, relative, win32, posix } from 'node:path';

const inside = (root, path) => { const offset = relative(root, path); return offset !== '..' && !offset.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) && !isAbsolute(offset); };
export function effectCacheRoot(platform = process.platform, env = process.env, home = homedir()) {
  if (!['win32', 'darwin'].includes(platform)) throw new Error('Unsupported CapCut effect-cache platform.');
  const paths = platform === 'win32' ? win32 : posix;
  if (env.AI_EDITOR_CAPCUT_EFFECT_CACHE) {
    if (!paths.isAbsolute(env.AI_EDITOR_CAPCUT_EFFECT_CACHE)) throw new Error('CapCut effect-cache override must be absolute.');
    return paths.normalize(env.AI_EDITOR_CAPCUT_EFFECT_CACHE);
  }
  return platform === 'win32'
    ? paths.join(env.LOCALAPPDATA || paths.join(home, 'AppData/Local'), 'CapCut/User Data/Cache/effect')
    : paths.join(home, 'Movies/CapCut/User Data/Cache/effect');
}

/** Search supplies identity; the installed CapCut bundle supplies real control names.
 * No downloaded Lua/shader is executed by AI-Editor. CapCut remains its renderer.
 */
export function inspectEffectResource(entry, item, root = effectCacheRoot()) {
  if (entry?.is_vip !== false || !/^[a-f0-9]{32}$/i.test(entry.md5 || '')) throw new Error('A known no-cost effect catalog entry is required.');
  if (!/^\d{5,24}$/.test(item?.resource_id || '') || item.stdraft_uri !== `vimo://${item.resource_id}`) throw new Error('An authoritative CapCut effect URI is required.');
  if (item.is_vip === true) throw new Error('Paid CapCut effects are disabled.');
  const folder = join(root, item.resource_id, entry.md5);
  if (!existsSync(folder)) return { available: false, resourceId: item.resource_id, controls: [], reason: 'Native resource is not yet present in CapCut’s cache.' };
  for (const path of [root, join(root, item.resource_id), folder]) {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('Linked native resource folders are not accepted.');
  }
  const metadata = join(folder, 'extra.json'), stat = lstatSync(metadata);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024) throw new Error('Invalid native resource metadata.');
  const bytes = readFileSync(metadata), data = JSON.parse(bytes);
  const params = data.setting?.effect_adjust_params || [];
  if (!Array.isArray(params) || params.length > 64) throw new Error('Invalid native effect controls.');
  const controls = params.map(param => {
    if (!/^effects_adjust_[a-z0-9_]{1,80}$/.test(param.effect_key) || ![param.min, param.max, param.default].every(Number.isFinite)
      || param.min > param.max || param.default < param.min || param.default > param.max) throw new Error('Invalid named native effect control.');
    return { name: param.effect_key, min: param.min, max: param.max, default: param.default };
  });
  if (new Set(controls.map(control => control.name)).size !== controls.length) throw new Error('Duplicate native effect controls.');
  return { available: true, resourceId: item.resource_id, folder, controls, metadataSha256: createHash('sha256').update(bytes).digest('hex') };
}

export function effectBundleFiles(folder, maximumBytes = 128 * 1024 * 1024) {
  const files = []; let bytes = 0;
  function visit(path, depth) {
    if (!inside(folder, path) || depth > 16) throw new Error('Native resource path escapes its bundle.');
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) throw new Error('Linked native resource files are not accepted.');
    if (stat.isDirectory()) for (const name of readdirSync(path)) visit(join(path, name), depth + 1);
    else if (stat.isFile()) {
      bytes += stat.size;
      if (files.length >= 4096 || bytes > maximumBytes) throw new Error('Native resource exceeds the local package budget.');
      files.push({ path, relative: relative(folder, path), size: stat.size });
    } else throw new Error('Unsupported native resource file type.');
  }
  visit(folder, 0); return files;
}

/** A cache directory can appear while CapCut is still extracting it. Check
 * the package entry points and fingerprint its payload before settling it.
 * Availability is still not proof of rendering or reference similarity.
 */
export function probeEffectBundle(entry, item, root = effectCacheRoot()) {
  const incomplete = () => ({ available: false, resourceId: item.resource_id, controls: [], reason: 'Native package extraction is incomplete.' });
  try {
    const resource = inspectEffectResource(entry, item, root);
    if (!resource.available) return resource;
    const files = effectBundleFiles(resource.folder);
    const configFile = files.find(file => file.relative === 'config.json');
    if (!configFile || !configFile.size || configFile.size > 1024 * 1024) return incomplete();
    const config = JSON.parse(readFileSync(configFile.path, 'utf8'));
    const links = config.effect?.Link;
    if (!Array.isArray(links) || !links.length) return incomplete();
    for (const link of links) {
      if (typeof link.path !== 'string' || !link.path || win32.isAbsolute(link.path) || posix.isAbsolute(link.path)
        || link.path.split(/[\\/]/).some(part => part === '..')) throw new Error('Unsafe native effect entry point.');
      const target = join(resource.folder, link.path);
      if (!inside(resource.folder, target)) throw new Error('Unsafe native effect entry point.');
      const payload = files.filter(file => inside(target, file.path) && file.size > 0);
      if (!payload.length) return incomplete();
      if (link.type === 'AmazingFeature' && !payload.some(file => file.path === join(target, 'main.scene'))) return incomplete();
    }
    const fingerprint = createHash('sha256');
    for (const file of files.sort((a, b) => a.relative.localeCompare(b.relative))) {
      const bytes = readFileSync(file.path);
      // CapCut's Motion Blur and Chromatic Quirk bundles ship this generated
      // RTTI sidecar empty. It is not the entry scene or shader payload. Keep
      // hashing it, and continue requiring every other file to be non-empty.
      if (!bytes.length && basename(file.path) !== 'LuaRTTI.MarkGen.lua') return incomplete();
      if (file.relative.endsWith('.json')) JSON.parse(bytes);
      fingerprint.update(file.relative).update('\0').update(bytes);
    }
    return { ...resource, bundleFingerprint: fingerprint.digest('hex') };
  } catch (error) {
    if (error.code === 'ENOENT' || error instanceof SyntaxError) return incomplete();
    throw error;
  }
}

export function selectOfficialEffect(entry, items) {
  const normalized = value => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const matches = items.filter(item => normalized(item.title || item.name) === normalized(entry.name) && item.is_vip !== true);
  const exact = matches.filter(item => item.resource_id === entry.resource_id);
  const selected = exact.length === 1 ? exact[0] : matches.length === 1 ? matches[0] : null;
  if (!selected) return null;
  if (!/^\d{5,24}$/.test(selected.resource_id) || selected.stdraft_uri !== `vimo://${selected.resource_id}`) throw new Error('Official effect identity is inconsistent.');
  return selected;
}
