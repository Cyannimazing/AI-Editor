import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { keyframeProperties, keyframeEasings } from '../../../toolchain/node_modules/capcut-cli/dist/decorators.js';
import { parseCommandContracts } from '../capcut/command-contracts.mjs';

// Installed, pinned contracts only. These names never come from media, URLs,
// user command strings or a shell. Discovery does not grant execution access.
export const capabilityTopics = {
  motion: { commands: ['keyframe', 'image-anim'], catalogs: ['image_intros', 'image_outros', 'image_combos'],
    available: 'Native position, scale, rotation and opacity curves; explicit peak/rebound/settling keys; linear/eased/hold interpolation.',
    gap: 'Preset image-animation dispatch is not part of the current plan adapter. Compose motion with native curves where equivalent.' },
  effects: { commands: ['add-effect', 'add-filter'], catalogs: ['scene_effects', 'character_effects', 'filters'],
    available: 'Clip-bound no-cost scene/character effects, with controller discovery of official resources and installed named controls.',
    gap: 'General filter dispatch and per-effect control animation are not exposed. Optical appearance needs native playback evidence.' },
  layers: { commands: ['mask', 'mix-mode', 'bg-blur'], catalogs: ['masks'],
    available: 'Independent source/image layers, native blend modes, generated script-free SVG assets and per-layer motion.',
    gap: 'Native mask and background-blur dispatch are not exposed. Do not claim those operations ran from reading this contract.' },
  text: { commands: ['text-style', 'text-ranges', 'text-anim'], catalogs: ['text_intros', 'text_outros', 'text_loop_anims'],
    available: 'Native editable text, installed fonts, bold/italic styling, placement, size and motion curves.',
    gap: 'Preset text-animation dispatch is not exposed. Keep words separate from decorative assets.' },
  audio: { commands: ['volume', 'audio-fade', 'loudness'], catalogs: ['audio_effects'],
    available: 'Retained source audio, segment volume and native volume curves; v5 local sine/noise sound composition into separate native audio tracks with fades/ducking and retained synthesis sources. Rendered mix measures clipping and silence.',
    gap: 'General audio-fade/loudness/transcription dispatch is not exposed; measurements are not semantic listening evidence.' },
  timeline: { commands: ['trim', 'speed', 'transition'], catalogs: ['transitions'],
    available: 'Timed source, text, generated assets and source overlay segments within the chosen clip interval.',
    gap: 'General source cuts/retiming and native transition dispatch need additional adapters. Do not silently omit a required technique.' },
};

export async function discoverEditingCapabilities(root, { topic, query }, signal) {
  if (!Object.hasOwn(capabilityTopics, topic) || typeof query !== 'string' || query.length > 120) throw new Error('Invalid capability query.');
  const selected = capabilityTopics[topic], entry = join(root, 'toolchain/node_modules/capcut-cli');
  const { stdout } = await promisify(execFile)(process.execPath,
    [join(entry, 'dist/index.js'), 'describe', ...selected.commands.flatMap(command => ['--command', command])],
    { timeout: 15000, maxBuffer: 1_000_000, windowsHide: true, signal });
  const contract = parseCommandContracts(stdout, selected.commands);
  // Read the reviewed package catalog directly; avoid ambient user-enum files.
  const catalog = JSON.parse(await readFile(join(entry, 'dist/enums.json'), 'utf8')).capcut;
  const words = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const entries = selected.catalogs.flatMap(category => (catalog[category] || []).map(item => ({ ...item, category })))
    .filter(item => item.is_vip === false)
    .map(item => ({ item, score: words.reduce((score, word) => score + Number(`${item.slug} ${item.name} ${item.member}`.toLocaleLowerCase().includes(word)), 0) }))
    .filter(result => !words.length || result.score > 0).sort((a, b) => b.score - a.score).slice(0, 12)
    .map(({ item }) => item);
  return { version: contract.version, topic, contracts: contract.commands, catalogMatches: entries,
    ...(topic === 'motion' ? { properties: keyframeProperties(), easing: keyframeEasings(),
      timing: 'Native offsets use microseconds local to the segment; app plan times use seconds. Write all neighboring keys together. Inspect actual saved Bezier handles. A hold needs a later key; the terminal value already persists to the end.' } : {}),
    application: { available: selected.available, adapterGap: selected.gap },
    rule: 'Catalog matches are discovery suggestions, not a choice, license grant, download, or native verification. Compose the requested behavior using available primitives; report genuine adapter gaps. Only apply_edit_plan can write this candidate. Never invent resource IDs or use paid/cloud alternatives.' };
}
