# Native CapCut editing with the installed community CLI

Primary source: the installed `toolchain/node_modules/capcut-cli/docs/`, `dist/command-specs.js`, `dist/compile.js`, `dist/decorators.js`, `dist/factory.js` and the CLI's `describe` output. The runtime snapshot records the exact installed version and contracts. This is community software, not an official ByteDance desktop API.

## Learn before writing

Use the host's CLI entry point with argument arrays, not shell interpolation. The examples below use `capcut` as shorthand; the host resolves Node and the installed `dist/index.js`.

```text
capcut describe --compact
capcut describe --command <command>
capcut <command> --help
capcut info <candidate>
capcut version <candidate>
capcut tracks <candidate>
capcut segments <candidate>
capcut segment <candidate> <segment-id>
capcut catalogue <technique-or-resource-name> --limit 12
capcut enums --scene-effects
```

Discover the category instead of guessing an ID. The installed catalog also contains transitions, masks, image and text animations, character effects, audio effects, filters and speech bubbles. `catalogue` searches across categories. Catalog availability, free/VIP metadata, a downloaded resource, successful opening and successful rendering are separate facts. Reject known paid entries; an unknown cost is not authorization to spend. Native evidence is still required.

In restricted editing sessions, call local MCP `discover_capabilities` with a topic (`motion`, `effects`, `layers`, `text`, `audio`, `timeline`) and short query instead of running the CLI yourself. It reads the installed version's exact contracts and no-cost bundled catalog entries. It also distinguishes controls already integrated into the app from operations requiring another adapter. Compose equivalent techniques from available primitives; never pretend a discovered command executed or silently replace a required technique with an unrelated effect.

## Build editable structure

- `compile` builds a draft from declarative tracks and operations. Its tracks support video/photo, text and audio; source start, target start, duration, speed, scale, position, rotation, opacity and volume are data, not generated scripts. Read `dist/compile.js` for the accepted item/operation shape.
- `add-video` adds local footage or a generated image. Add each decorative asset on its own layer so timing, position, size, rotation and opacity remain editable. Keep its editable vector/code source alongside the job.
- `add-text`, `text-style`, `text-ranges`, `import-srt` and `import-ass` create actual editable text and styling. `bubble-text` applies a native speech-bubble resource when a suitable usable resource is available. Text must remain separate from a generated decorative shape.
- `trim`, `speed`, `shift`, `duplicate`, `remove`, `cut`, `concat` and timeline import/export address different timeline operations. Read the exact contract: `cut` extracts an interval into another draft; it is not a generic split-at-playhead command. Avoid changing unrelated intervals/tracks.
- `transition` links neighboring segments; inspect overlap requirements and available handles. Never place a transition on an arbitrary isolated item and call it verified.
- `add-effect`, `add-filter`, `mask`, `bg-blur`, `mix-mode`, `chroma`, `matting`, `image-anim` and `text-anim` provide native editing operations. Prefer native controls when the requested behavior can be expressed correctly. Bind/isolate scene effects so they cannot affect unrelated footage. A standalone global effect track is not equivalent to a clip-bound effect.
- `audio-fade`, `volume` and volume keyframes provide native mixing controls. Local audio analysis determines timing and levels; catalog sound effects need verified provenance and resource availability.

## Keyframes and time

Native timeline JSON uses microseconds. Most CLI and compile inputs use seconds; inspect each command rather than mixing units. Keyframe time is local to its segment. New overlays must be offset to the selected clip's timeline start when integrated.

The installed CLI discovers canonical keyframe properties using `keyframeProperties()`: position_x, position_y, scale_x, scale_y, uniform_scale, rotation, alpha, volume, brightness, contrast and saturation in the researched version. Query again after upgrades. Alias `scale` maps to uniform scale; application code may deliberately emit both axis curves instead. Check `uniform_scale` consistency so the app does not combine two incompatible scale representations.

```text
capcut keyframe <candidate> <segment> position_x 0 0
capcut keyframe <candidate> <segment> position_x 0.3 0.1 --easing ease-out
capcut keyframe <candidate> <segment> alpha 0 0
capcut keyframe <candidate> <segment> alpha 0.15 1
```

Use measured keyframe times/values for overshoot, shakes, flashes, zooms, pans, entrances and exits. Preserve untouched existing curves and apply motion relative to existing placement when required. A request may combine multiple native properties and generated assets. Do not reduce editing to transforms alone.

## Compatibility and review

Seed empty projects from a project authored by the installed CapCut version. The bundled older template can produce an “unusual path” error on newer builds even when its path is correct. Preserve native format/version markers and validated active-timeline pointers. Never suppress version/write guards with `--force-write`.

The app can maintain several root/nested timeline documents. Inspect their consistency; do not overwrite a live project while CapCut is saving. Only trusted services close/open the desktop, publish separate review projects, register materials and commit originals.

`lint` checks structure/dependencies. `diagnose` and `version` assist compatibility review. `batch --plan` / `--apply-plan` bind a reviewed operation list to a draft hash; do not use `--continue-on-error` to disguise an incomplete edit.

`render` is an FFmpeg proxy. `--all-video-tracks` and `--burn-captions` can include more elements; they do not reproduce all native effects, keyframes, transitions, masks or text styling. `--strict` refuses fidelity omissions, and `--verify` checks duration/probe integrity. An export shortcut is not proof of an exported file. Opening a project is not proof of a visual match or successful export.

Upstream reference: https://github.com/renezander030/capcut-cli

## Calibrated application adapters

Write every segment's complete keyframe batch together. The pinned CLI needs neighboring keyframes in the same call to materialize a hold. Do not issue isolated one-frame calls and ignore warnings. The app evaluates the resulting serialized Bezier handles for its local motion preview.

On Windows CapCut 9.6.0.4097, the video material's Blend enable bit (`check_flag | 8`) is required for opacity curves to execute. A disposable native export reproduced the failure with flag 7 and passed sampled movement/hold checks after flag 15. The trusted compiler sets this on private replacement materials; unrelated material flags are preserved. This is version-specific calibration evidence, not universal platform certification.

The v4 text contract supports native bold/italic ranges and installed local TTF/OTF fonts discovered with Fontkit. Select an exact host-reported font ID; never invent a path, download a paid font, or claim an exact match without comparing it. Common-font IDs remain compatible with earlier plans. System font collections require a future face-selection adapter. Font metrics remain part of visual acceptance. Generated text stays native.

Text size conversion and preview decoding now share `src/server/editing/native-text.mjs` (relative units based on the short canvas dimension). Portrait type must not be divided by the long canvas height. The browser reads the saved native text, fill, size and font path, rather than substituting the intended plan. This removes an internal inconsistency; native font substitution and exact glyph metrics still need export calibration. The older landscape fixture only checked text presence, not matching text bounds, so it must not be cited as typography certification.

Catalog entries and the CLI's inline starter effects can have different IDs. The host pins the actual no-cost catalog resource IDs it checked, records the written IDs and still requires observed native playback.
