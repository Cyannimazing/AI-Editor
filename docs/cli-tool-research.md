# Editing CLI research and startup context — 2026-10-27

This report separates tool capability, current integration and demonstrated output. Research used the installed versions' command help, source code/contracts, catalogs and local runtime checks, plus primary upstream documentation. No paid generation, cloud rendering, model download or purchase was performed.

## Findings

| Tool | Observed local evidence | Editing use | Integration implication |
| --- | --- | --- | --- |
| CapCut CLI 0.31.1 | 88 discovered command contracts; 11 native keyframe properties; 116 transition and 345 scene-effect catalog entries | Native editable timelines, cuts/retiming, text, layers, masks, effects, blends, animation and audio controls | The app's v2 output schema exposes only a subset; it must not describe unexposed operations as CLI limitations |
| FFmpeg / FFprobe | Binaries launch; installed filter inventory is collected rather than assumed | Source preparation, timing/scene/audio analysis, procedural media, compositing and previews | Probe exact codecs/filters and verify output; retain native controls for promised editability |
| HyperFrames 0.8.193 | CLI help, doctor, transcription help and media-treatment discovery | HTML/GSAP graphics, local assets, grading, retro/glitch, transparent overlays, layout/timed inspection | CLI installed; doctor finds Chrome, but no end-to-end composition render was proven in this research |
| Remotion 4.0.538 | Installed CLI help and matching packages | React/frame-based compositions and local still/video rendering | License eligibility and browser/render execution are separate checks; no paid or cloud route enabled |
| Codex | Existing signed-in account and structured CLI execution | Planning, reference analysis and separate review roles | The host injects tool instructions/inventory; worker shell/desktop access remains disabled |

CapCut catalogs identify resources; they do not prove current account availability, cost, local download state or native rendering. Free/VIP metadata can be version-dependent. Do not invent effect IDs or spend credits. HyperFrames doctor found optional Whisper/TTS/music runtimes missing and very limited available RAM during the probe; use one render worker and prepare any vetted local models explicitly. Those runtimes are not prerequisites for every basic editing task.

## Why the reported edit failed

The host asked for v2 JSON containing source transforms/keyframes and editable text. It explicitly categorized asset generation, cuts and third-party effects as unsupported. The model reported the thought graphic and optical effects in `unsupported`, and `compile-controlled-edit.mjs` rejected any non-empty unsupported list. This is an application planner/executor restriction, not evidence that all installed tools lack those operations.

The host also failed to inject the reference contact sheets' frame timestamps even though it had extracted them. The model consequently reported timing as unavailable. Timed contact-sheet metadata and explicit audio-evidence status are now included in build prompts.

## Context implementation

- `ai/context-index.json` selects shared and role-specific guides. `ai/workflows/editing.md` explains general technique decomposition, tool discovery, generation, native implementation and correction. Tool guides cover native CapCut, assets/motion and media/audio; reviewers have a separate evidence guide.
- `scripts/inspect-editing-tools.mjs` performs offline discovery from installed contracts/catalogs and binary probes. It records versions and documentation hashes. `pnpm tools:inspect` emits the complete JSON inventory.
- Setup saves `.local-tools/tool-knowledge/inventory.json` and validates role guides. Workers receive their selected guides and an inventory summary. Each job retains `context-manifest-<role>.json` with source hashes and package versions. Missing/oversized/out-of-root guides fail loading.
- Discovery is cached for the running app and invalidated by the toolchain lock/config and discovery/index source changes. Role guide contents are reread for each worker. Restart after replacing installed binaries/packages outside normal setup so their runtime state is reprobed.

This is startup instruction/context loading, not model training. It does not automatically implement adapters or give workers unrestricted command execution.

## Subsequent integration work

The app now owns CapCut sign-in and callback state, discovers live tool availability in an ephemeral Codex App Server thread, and brokers the exact official material-search operation. A live search returned authoritative `vimo://` effect references. No generation, uploads or cloud draft writes were invoked. Connection controls are available from the workspace; manual material-search UI has been removed. Workers can request resource queries during Run, and the controller returns results before continuing the build.

The native build contract has advanced to v3: script-free generated SVG/PNG assets with retained sources; source-frame extraction with recorded parameters; independent photo/source overlays and blends; native color/motion keyframes; and no-cost-catalog effects bound to the edited source or a generated layer. Unit/integration tests cover generated art, native text retention, asset dependency paths and source-bound effect controls. These additions are broader primitives, not a hard-coded thought-cloud template. The current reference trial and native verification must still supply their own evidence; catalog presence and graph validity are not a passed visual comparison.

## Editing architecture decision

Use technique analysis followed by capability discovery and ordered host operations. Prefer native editable text, layers, keyframes, effects/masks/blends, cuts and audio controls. Generate missing assets with reusable local vector/composition tools and retain sources. Choose a procedural representation by need; do not hard-code a thought-cloud recipe as the whole system. Supply evidence back to the planner and review each technique against actual output.

Continue broadening the versioned operation contract with validated host adapters. The v3 integration now implements bound native effects and generated asset provenance; the earlier complex-reference request passes construction/lint. General cuts/retiming, masks, transitions, audio analysis and composition-runtime adapters still need expansion. Preview/native parity and native export verification remain open. The unsupported guard stays in place so an incomplete candidate cannot be presented as a complete edit.

The Windows proxy adapter uses a discovered local font, limits FFmpeg filter workers, preserves native layer stacking and probes duration before publishing a preview. It runs under the existing cancellable process-tree controller. Its fidelity receipt lists dropped native effects/keyframes, and reviewer prompts receive exact timing maps for both reference and preview sheets. A successful proxy is not a successful CapCut export.

## Primary sources

- Installed `capcut-cli/docs/command-reference.md`, `dist/command-specs.js`, `dist/compile.js`, `dist/decorators.js`, `dist/factory.js`, `dist/enums.json`; [upstream repository](https://github.com/renezander030/capcut-cli).
- Installed HyperFrames `--help`, `doctor`, `transcribe --help`, `media-treatment --capabilities --json`; [upstream repository](https://github.com/heygen-com/hyperframes).
- [GSAP timeline documentation](https://gsap.com/docs/v3/GSAP/Timeline/) and [license](https://gsap.com/community/standard-license/).
- Installed Remotion CLI help; [CLI reference](https://www.remotion.dev/docs/cli) and [license documentation](https://www.remotion.dev/docs/license).
- Installed FFmpeg filter help and FFprobe version; [official documentation](https://ffmpeg.org/documentation.html).
- [Codex App Server documentation](https://learn.chatgpt.com/docs/app-server) and observed local CLI/session behavior.
