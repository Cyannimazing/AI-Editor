import { lookup } from 'node:dns/promises';
import { isIP, BlockList } from 'node:net';
import { request } from 'node:https';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const blocked = new BlockList();
for (const [address, prefix] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]]) blocked.addSubnet(address, prefix, 'ipv4');
const globalV6 = new BlockList(); globalV6.addSubnet('2000::', 3, 'ipv6');
for (const [address, prefix] of [['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['3fff::', 20]]) blocked.addSubnet(address, prefix, 'ipv6');

export function isPublicAddress(address) {
  const family = isIP(address);
  return family === 4 ? !blocked.check(address, 'ipv4') : family === 6 && globalV6.check(address, 'ipv6') && !blocked.check(address, 'ipv6');
}
export function publicReferenceUrl(input) {
  if (typeof input !== 'string' || input.length > 2048) throw new Error('Use a public HTTPS reference link under 2,048 characters.');
  let url; try { url = new URL(input); } catch { throw new Error('Enter a valid public HTTPS reference link.'); }
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) throw new Error('References require public HTTPS links without credentials or custom ports.');
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local') || (isIP(hostname) && !isPublicAddress(hostname))) throw new Error('Local and private network references are not allowed.');
  url.hash = ''; return url;
}

async function fetchPublic(url, signal) {
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  // Validate every DNS answer, then pin the connection to a validated address.
  // Each redirect repeats validation; no browser cookies or account tokens are sent.
  const addresses = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }] : await lookup(hostname, { all: true, verbatim: true });
  signal.throwIfAborted();
  if (!addresses.length || addresses.some(item => !isPublicAddress(item.address))) throw new Error('The reference resolves to a local, private or reserved address.');
  const pinned = addresses[0];
  return new Promise((resolve, reject) => {
    const req = request(url, { signal, agent: false, method: 'GET', headers: { 'User-Agent': 'AI-Editor/0.1 reference-reader', Accept: 'video/*,image/*,text/html;q=0.8', 'Accept-Encoding': 'identity' },
      lookup: (_hostname, options, callback) => options.all ? callback(null, [pinned]) : callback(null, pinned.address, pinned.family) }, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
        res.destroy(); return resolve({ redirect: res.headers.location });
      }
      if (res.statusCode !== 200) { res.destroy(); return reject(new Error(`The public reference returned HTTP ${res.statusCode}. Download permitted media and attach it instead.`)); }
      const type = String(res.headers['content-type'] || '').split(';')[0].toLowerCase();
      const limit = type === 'text/html' ? 2 * 1024 * 1024 : 100 * 1024 * 1024;
      if (!['text/html', 'image/png', 'image/jpeg', 'image/webp', 'video/mp4', 'video/webm', 'video/quicktime', 'video/x-matroska'].includes(type)) { res.destroy(); return reject(new Error('This link does not provide supported public image or video media. Attach the file instead.')); }
      if (Number(res.headers['content-length']) > limit || (res.headers['content-encoding'] && res.headers['content-encoding'] !== 'identity')) { res.destroy(); return reject(new Error('The public reference is too large or uses unsupported compression. Attach a smaller file.')); }
      const chunks = []; let bytes = 0;
      res.on('data', chunk => { bytes += chunk.length; if (bytes > limit) res.destroy(new Error('The public reference exceeds its download limit.')); else chunks.push(chunk); });
      res.on('error', reject); res.on('end', () => resolve({ type, bytes: Buffer.concat(chunks) }));
    });
    req.setTimeout(15000, () => req.destroy(new Error('The public reference timed out. Attach the file instead.')));
    req.once('error', reject); req.end();
  });
}

function decodeAttribute(value) { return value.replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;/g, "'").replace(/&#(\d+);/g, (_, code) => Number(code) <= 0x10ffff ? String.fromCodePoint(Number(code)) : ''); }
export function pageMediaLink(html, base) {
  const media = new Map();
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const attributes = Object.fromEntries([...tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)].map(match => [match[1].toLowerCase(), decodeAttribute(match[2] ?? match[3] ?? match[4])]));
    const key = attributes.property || attributes.name;
    if (key && attributes.content && !media.has(key)) media.set(key.toLowerCase(), attributes.content);
  }
  for (const key of ['og:video:secure_url', 'og:video:url', 'og:video', 'og:image:secure_url', 'og:image', 'twitter:image']) {
    const value = media.get(key);
    if (value) return publicReferenceUrl(new URL(value, base).href);
  }
  throw new Error('This page exposes no readable reference media. Login-only pages, embedded players and JavaScript-only sites require an attached video or image.');
}

export async function downloadPublicReference(input, folder, outerSignal) {
  const signal = outerSignal ? AbortSignal.any([outerSignal, AbortSignal.timeout(45000)]) : AbortSignal.timeout(45000);
  let url = publicReferenceUrl(input), pageRead = false;
  for (let attempt = 0; attempt < 6; attempt++) {
    signal.throwIfAborted(); const response = await fetchPublic(url, signal);
    if ('redirect' in response) {
      if (!response.redirect) throw new Error('The reference redirect has no destination.');
      url = publicReferenceUrl(new URL(response.redirect, url).href); continue;
    }
    if (response.type === 'text/html') {
      if (pageRead) throw new Error('This page links to an embedded player instead of downloadable media. Attach the reference file.');
      url = pageMediaLink(response.bytes.toString('utf8'), url); pageRead = true; continue;
    }
    const extensions = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'video/mp4': '.mp4', 'video/webm': '.webm', 'video/quicktime': '.mov', 'video/x-matroska': '.mkv' };
    const path = join(folder, `public-reference${extensions[response.type]}`);
    await writeFile(path, response.bytes, { flag: 'wx' });
    return { path, kind: response.type.startsWith('video/') ? 'video' : 'image', fromPage: pageRead };
  }
  throw new Error('The public reference has too many redirects. Attach the media file.');
}
