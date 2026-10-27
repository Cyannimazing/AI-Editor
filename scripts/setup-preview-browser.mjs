import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { mkdir, realpath, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { previewBrowser } from '../src/server/platform/browser.mjs';

const root = process.cwd(), env = { ...process.env, HYPERFRAMES_NO_TELEMETRY: '1', HYPERFRAMES_NO_UPDATE_CHECK: '1', HYPERFRAMES_NO_AUTO_INSTALL: '1', DO_NOT_TRACK: '1' };
let executablePath = previewBrowser(root);
if (!executablePath) {
  // The pinned HyperFrames release manages its pinned Chrome-for-Testing build.
  // Its documented path command ensures a missing browser, without opening UI.
  const { stdout } = await promisify(execFile)(process.execPath, [join(root, 'toolchain/node_modules/hyperframes/bin/hyperframes.mjs'), 'browser', 'path'],
    { cwd: root, env, windowsHide: true, timeout: 300000, maxBuffer: 100000 });
  const candidate = stdout.trim().split(/\r?\n/).at(-1);
  if (!candidate || !isAbsolute(candidate)) throw new Error('Preview browser setup returned an invalid path.');
  executablePath = await realpath(candidate);
}
const require = createRequire(await realpath(join(root, 'toolchain/node_modules/hyperframes/package.json')));
const puppeteer = require('puppeteer-core');
let browser;
try {
  browser = await puppeteer.launch({ executablePath, headless: true, timeout: 30000, args: ['--no-first-run', '--no-default-browser-check'] });
  const page = await browser.newPage(); await page.setContent('<html><body>AI-Editor preview check</body></html>');
  const pixels = await page.screenshot(); if (pixels.length < 100) throw new Error('The background browser did not render.');
  await mkdir(join(root, '.local-tools'), { recursive: true });
  await writeFile(join(root, '.local-tools/preview-browser.json'), JSON.stringify({ executablePath, platform: process.platform, arch: process.arch, version: await browser.version(), headlessVerified: true }));
  console.log('Background preview browser verified.');
} finally { await browser?.close(); }
