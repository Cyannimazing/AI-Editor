# Local MCP editing: findings and implementation

Reviewed 2026-10-28 against installed source and the linked projects. The goal is technique transfer onto the user's footage, including unrelated references, rather than scene cloning.

## What actually caused the failures

- Editing workers had every tool invocation blocked and explicitly disabled Codex's tool host. They returned a JSON plan from supplied contact sheets; they could not request an individual frame or inspect their own constructed timeline. A real MCP/Codex probe reproduced the disabled-host failure.
- Uploaded media contained encoded black padding. Scaling/moving that padded rectangle moved the empty space with the footage. Sparse landmark matches sometimes required pixels absent from the source; copying those fits produced smaller floating footage.
- Source and reference coordinates, asset transparent margins and independent text motion could disagree. A shape and its label need a coupled path, not unrelated transforms.
- Preview typography previously used requested sizes instead of actual serialized native sizes. Effects remain a separate fidelity problem: the browser preview does not reproduce all CapCut optical effects.
- Effect labels alone were insufficient. The existing official effect bridge resolves actual resources and installed named controls; missing bundles/playback evidence must stay visible.
- Geometric similarity was sometimes treated as acceptance. A different reference should transfer timing, motion behavior and treatment, without requiring identical scenery or unavailable source pixels.

## MCP choices

| Choice | Observed capabilities | Decision |
| --- | --- | --- |
| Installed CapCut × ChatGPT plugin | Official online material tools plus a bundled local STDraft builder; AI-Editor already invokes discovery through Codex MCP and bridges supported local effects | Retain optional discovery; uploads/paid operations remain disabled |
| `fancyboi999/capcut-mcp` | Python CapCutAPI fork; README describes HTTP/MCP draft generation; repository marked archived | Do not replace the tested compiler with an archived backend |
| `Atx-Guy/capcut-mcp-server` | TypeScript stdio/HTTP wrapper requiring a separate VectCutAPI backend; keyframe schema exposes property/time/value arrays, without easing handles in that interface | Useful design reference; not evidence of better motion fidelity or current native-version compatibility |
| AI-Editor's local MCP bridge | Bound to one job; timed image inspection, measured-curve evaluation, validated native candidate construction and serialized timeline readback | Use the already installed native compiler and existing preservation checks, with genuine Codex tool calls |
| `renezander030/capcut-cli` 0.31.1 | Already pinned in the app; native draft compiler, Bezier/hold keyframes, layered text/media, effect catalogs, timeline-aware atomic storage and diagnostics | Keep as the local backend behind MCP; inspect exact installed contracts instead of adding a duplicate service |

MCP is the tool connection, not a video renderer or an accuracy guarantee. Local draft tools do not provide a supported live CapCut desktop editing API. Codex inference still uses the user's account online; draft construction and media processing run locally. CapCut's current official site does advertise CapCut × ChatGPT, so older blanket claims that no official connection exists are not a reliable description of today's tools.

## Runtime workflow

1. Retain the original upload. For a fresh full-picture project, detect stable paired encoded black bands across multiple frames and prepare a job-owned picture-only derivative. Preserve audio and duration; record hashes and crop coordinates. Preserve existing project canvases and explicitly requested borders.
2. Prepare reference evidence in the same picture coordinate system when aspects are compatible. Retain the original reference and record normalization. Unrelated/aspect-mismatched references remain technique evidence, not pixel-registration targets.
3. Start a local stdio MCP server for each restricted Codex role. No HTTP listener, external service credentials or global Codex config edits are needed.
4. The lead calls `inspect_job`, requests precise `reference_frames`, tests the complete plan with `evaluate_keyframes`, and can construct the candidate with `apply_edit_plan`. `inspect_timeline` reads the real saved curves/layers. Independent roles cannot invoke the write tool.
5. Integrate specialist findings, resolve official resources through the existing no-paid-service bridge, compile, render the local preview and run independent technique/coverage review. Retain all required techniques across corrections. A passed first review stops; the correction budget is a ceiling.
6. Native verification remains a distinct acceptance step. No MCP tool claims that draft construction or an approximate preview proves CapCut playback/export fidelity.

All tool calls take structured editing data or frame times, not arbitrary paths/commands/URLs. Writes are restricted to the candidate selected by the host. The tool host is enabled; shell, patch, desktop, unrelated plugins and unknown tools remain blocked. Local MCP dependencies are pinned in the toolchain lockfile. Process invocation uses argument arrays and shared Node code on Windows/macOS; platform desktop operations remain in their adapters.

## Additional study of the linked CLI

The upstream README, command reference, editing skill, compatibility matrix and installed decorator implementation were checked together. Useful integration details are complete neighboring-key batches for easing/holds; segment-local microsecond offsets; active-timeline consistency instead of root-only writes; app-authored templates for modern project registration; and progressive, bounded inspection. The library's proxy renderer is explicitly approximate. Its experimental Wasm MCP exposes read-only inspection, not the editing operations required here. A new MCP connection alone cannot improve visual fidelity without correct controls, source geometry and output review.

The app now exposes `discover_capabilities` through its local MCP bridge. It returns exact installed contracts and searches only the pinned no-cost catalog, with current app adapter coverage shown separately. This supports creative combinations without inventing available commands or resources. It does not enable the repository's optional cloud captions, API-key translation, sponsor packs, force-write overrides or arbitrary shell recipes. General cuts/retiming, native masks/transitions and native export still require additional application work; documenting their CLI support is not implementation.

Primary references: [repository](https://github.com/renezander030/capcut-cli), [command reference](https://github.com/renezander030/capcut-cli/blob/master/docs/command-reference.md), [editing skill](https://github.com/renezander030/capcut-cli/blob/master/skills/capcut-edit/SKILL.md), [version evidence](https://github.com/renezander030/capcut-cli/blob/master/docs/version-support.md).

## Evidence

- `scripts/local-editing-mcp.test.mjs`: real stdio protocol, native curve write/readback, extra-argument rejection and read-only-role enforcement.
- `scripts/local-mcp-codex-smoke.mjs`: signed-in Codex calls inspect/evaluate/apply/readback against a disposable fixture. First probe failed with the host disabled; second passed after enabling the installed host. Actual receipt: `.local-tools/local-mcp-smoke-result.json`.
- `scripts/picture-framing.test.mjs`: stable padding versus dark/moving/one-sided boundaries, preserved source bytes/audio/duration, decoded filled frames and between-keyframe coverage.
- Local reference crop replay: `.local-tools/fill-preparation-test.json`. Both working videos are 720×1278; original files retained. This is framing evidence, not a professional-edit acceptance result.
- Real MacBook execution and automatic revision-bound native capture/export remain unverified. Do not relabel these as passes based on Windows fixtures.

Sources: [Codex MCP configuration](https://learn.chatgpt.com/docs/extend/mcp), [CapCut's official workflow](https://www.capcut.com/tools/capcut-x-codex), [community CapCutAPI fork](https://github.com/fancyboi999/capcut-mcp/blob/main/README.md), [Atx-Guy server](https://github.com/Atx-Guy/capcut-mcp-server), [its actual keyframe schema](https://github.com/Atx-Guy/capcut-mcp-server/blob/main/src/schemas/index.ts), and installed `capcut-cli` 0.31.1 source/command contracts.
