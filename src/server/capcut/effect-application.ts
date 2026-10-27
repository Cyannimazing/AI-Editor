import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { localEffectBuilder } from './local-builder.mjs';
import { runCancellableProcess } from '../../lib/cancellable-process';
import { searchCapcutMaterials } from './plugin';
import { effectBundleFiles, inspectEffectResource, selectOfficialEffect } from './effect-resources.mjs';
import { assertNoLinks } from '../security/paths';

type Entry = { slug: string; name: string; is_vip: boolean; md5: string; resource_id: string; effect_id: string };
type Item = { resource_id: string; stdraft_uri: string; title?: string; name?: string; is_vip?: boolean };
type Effect = { slug: string; target: string; start: number; duration: number; intensity: number; params: number[] };
type Discovery = { entry: Entry; item: Item; resource: ReturnType<typeof inspectEffectResource> };

/** Called by the job controller, never by a second user-facing search workflow. */
export async function discoverOfficialEffects(input: {
  effects: Effect[]; catalog: Entry[]; cache: Map<string, unknown>; connected: boolean;
  onLog: (line: string) => void; signal?: AbortSignal;
}) {
  const discovered: Record<string, Discovery> = {};
  if (!input.connected) return discovered;
  for (const slug of new Set(input.effects.map(effect => effect.slug))) {
    input.signal?.throwIfAborted();
    const entry = input.catalog.find(item => item.slug === slug && item.is_vip === false);
    if (!entry) throw new Error(`A no-cost native effect is required: ${slug}.`);
    const key = `native-effect:${slug}`;
    let result = input.cache.get(key) as { items: Item[] } | undefined;
    if (!result) {
      input.onLog(`CapCut plugin: finding the official ${entry.name} resource automatically.`);
      const found = await searchCapcutMaterials({ kind: 'video_effect', query: entry.name }, 20);
      input.signal?.throwIfAborted();
      result = { ...found, items: found.items.filter((item): item is Item => typeof item.resource_id === 'string' && typeof item.stdraft_uri === 'string') };
      input.cache.set(key, result);
    }
    const item = selectOfficialEffect(entry, result.items) as Item | null;
    if (!item) { input.onLog(`CapCut did not return one unambiguous ${entry.name} resource. Its native catalog entry remains unverified.`); continue; }
    discovered[slug] = { entry, item, resource: inspectEffectResource(entry, item) };
  }
  return discovered;
}

export function officialEffectContext(discovered: Record<string, Discovery>) {
  return Object.fromEntries(Object.entries(discovered).map(([slug, value]) => [slug, {
    source: value.item.stdraft_uri, title: value.item.title, localControlsAvailable: value.resource.available,
    controls: value.resource.controls, controlsInput: 'params uses this control order, as percentages of each min..max range; [] uses the actual native defaults.',
  }]));
}

/** The official builder supplies validated effect segments. Our native adapter
 * consumes their resource/control fields; it is not an official desktop converter.
 */
export async function applyOfficialEffects(input: {
  job: string; iteration: number; effects: Effect[]; discovered: Record<string, Discovery>;
  width: number; height: number; duration: number; onLog: (line: string) => void; signal?: AbortSignal;
}) {
  const selected = input.effects.flatMap((effect, index) => input.discovered[effect.slug] ? [{ effect, index, discovery: input.discovered[effect.slug] }] : []);
  if (!selected.length) return { applied: 0, bindings: [] };
  await assertNoLinks(input.job);
  const builder = localEffectBuilder();
  if (!builder.available || !builder.root || !builder.python) throw new Error(builder.reason);
  const { root: plugin, python } = builder;
  const effects = selected.map(({ effect, index, discovery }) => {
    const parameters = discovery.resource.controls;
    if (effect.params.length && (!discovery.resource.available || effect.params.length !== parameters.length)) throw new Error(`Use the discovered named controls for ${effect.slug}: ${parameters.map((control: { name: string }) => control.name).join(', ')}.`);
    const controls = Object.fromEntries(parameters.map((control: { name: string; min: number; max: number; default: number }, parameter: number) =>
      [control.name, effect.params.length ? control.min + effect.params[parameter] / 100 * (control.max - control.min) : control.default]));
    const startMs = Math.round(effect.start * 1000), endMs = Math.round((effect.start + effect.duration) * 1000);
    if (endMs <= startMs) throw new Error('The official effect interval is shorter than its millisecond timebase.');
    return { index, source: discovery.item.stdraft_uri, startMs, durationMs: endMs - startMs, controls };
  });
  const request = join(input.job, `plugin-effects-request-${input.iteration}.json`), output = join(input.job, `plugin-effects-${input.iteration}.json`);
  await writeFile(request, JSON.stringify({ width: input.width, height: input.height, durationMs: Math.round(input.duration * 1000), effects }));
  input.onLog('CapCut plugin: applying effect segments with its installed local builder. No footage upload or cloud save.');
  await runCancellableProcess(python, ['-I', '-B', join(process.cwd(), 'scripts/apply-plugin-effects.py'), plugin, request, output],
    { cwd: process.cwd(), timeoutMs: 30000, signal: input.signal, onLine: input.onLog });
  const result = JSON.parse(await readFile(output, 'utf8'));
  if (result.provider !== 'official-capcut-local-builder' || result.cloudSaved !== false || result.mediaUploaded !== false || result.operations?.length !== selected.length) throw new Error('Invalid official effect application receipt.');
  const bindings = [];
  for (const { effect, index, discovery } of selected) {
    input.signal?.throwIfAborted();
    const operation = result.operations.find((item: { index: number }) => item.index === index);
    const expected = effects.find(item => item.index === index)!;
    if (!operation?.check_result?.valid || operation.segment?.type !== 'VIDEO_EFFECT' || operation.segment.attributes?.source !== expected.source
      || operation.segment.timeline?.['start.ms'] !== expected.startMs || operation.segment.timeline?.['duration.ms'] !== expected.durationMs) throw new Error('Official builder changed the requested effect identity or timing.');
    const controls = Object.entries(expected.controls).map(([name, value]) => {
      if (operation.segment.attributes[name] !== value) throw new Error('Official builder changed a native effect control.');
      const control = discovery.resource.controls.find((control: { name: string }) => control.name === name);
      if (!control) throw new Error('Official builder returned an unknown control.');
      return { name, value, default_value: control.default };
    });
    let localPath: string | undefined;
    const hashes = [];
    if (discovery.resource.available) {
      localPath = join(input.job, 'native-resources', discovery.item.resource_id, discovery.entry.md5);
      for (const file of effectBundleFiles(discovery.resource.folder)) {
        const destination = join(localPath, file.relative);
        await mkdir(dirname(destination), { recursive: true });
        const sourceBytes = await readFile(file.path), digest = createHash('sha256').update(sourceBytes).digest('hex');
        if (existsSync(destination)) {
          if (createHash('sha256').update(await readFile(destination)).digest('hex') !== digest) throw new Error('A cached native effect resource changed.');
        } else await copyFile(file.path, destination);
        hashes.push({ path: file.relative, sha256: digest });
      }
    }
    bindings.push({ index, slug: effect.slug, source: operation.segment.attributes.source, pluginSegmentId: operation.segment.id,
      resourceId: discovery.item.resource_id, effectId: discovery.item.resource_id, localPath, controls, resourceFiles: hashes,
      nativePlaybackVerified: false, controlsVerified: discovery.resource.available,
      timeline: operation.segment.timeline, exactNativeTiming: { start: Math.round(effect.start * 1e6), duration: Math.round(effect.duration * 1e6) } });
  }
  await writeFile(join(input.job, `native-effect-bindings-${input.iteration}.json`), JSON.stringify({ version: 1, provider: result.provider, bindings }));
  return { applied: bindings.length, bindings };
}
