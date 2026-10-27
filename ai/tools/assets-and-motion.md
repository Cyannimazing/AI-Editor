# Local asset generation and motion

Choose a representation from the visual requirement, then map its components to native CapCut controls. A shape missing from the user's media is a generation task. Do not require a particular named effect or prebuilt template for every technique.

## Representation choices

The current v4 host renders a HyperFrames/GSAP preview from the candidate's serialized native curves, including Bezier handles and frame-aligned holds. It runs local lint, validation, layout inspection and render. This makes movement observable during review; native catalog effects still require CapCut output. Never treat an omitted optical effect as a passed match. The host retains preview check reports and explicitly marks volume-curve and effect omissions.

| Need | Local representation | Native result |
| --- | --- | --- |
| Shape, bubble, icon, diagram, line art | Authored SVG with retained source; rasterize when CapCut needs an image | Separate image layer, editable timing/transform/opacity; SVG source editable outside CapCut |
| Typography/captions | Exact wording and layout/timing data | Native text layers, not text baked into an image |
| Simple motion | Explicit keyframe curves with values, times, easing | Native segment keyframes |
| Complex graphic/particle/shader animation | HyperFrames/GSAP or eligible Remotion composition with retained sources | Translate supported components; an imported rendered overlay retains layer controls but its internal pixels are not native editable components |
| Optical effect/compositing | Native effects/masks/blends where available, or a reviewed procedural layer recipe | Preserve controls and source layers; report any rendered-asset boundary |
| Photorealistic generated media | A separately verified local model/runtime | Do not claim installed motion tools provide a local diffusion/video model |

A composition render is useful as a preview or an explicitly permitted generated asset. It cannot silently replace a promise of editable CapCut text, curves, masks and effects. Treat SVG/HTML/React input as code/data requiring a registered validating renderer; documentation does not authorize running arbitrary source against private files or the network.

The v3 native builder now has a local shape renderer: return script-free SVG geometry with dimensions and an asset ID. It retains the SVG and creates a transparent PNG in a job-owned generation directory, then imports it as an independent native image layer. Keep words in the separate text array. It also extracts source-frame assets with explicit source time and provenance; animate a still layer for a native editable freeze/hold. Native effects may target the source, an overlay or a text layer by its compiled reference. Pick the needed primitive combination from the evidence rather than excluding graphics, holds or layer-specific effects from the outset.

## HyperFrames + GSAP

Use installed `hyperframes --help`, `<command> --help` and `docs`. Inspect runtime prerequisites with `doctor`; installed npm files do not establish browser, ASR, TTS or model readiness. Runtime commands may offer cloud/AI options; select verified local paths only. Avoid `publish`, `cloud`, `lambda`, `cloudrun` and provider credentials.

Workflow:

1. Capture the user's/reference visual identity in DESIGN.md: canvas, palette, typography, geometry and motion intent. A supplied visual reference supplies direction; do not ask generic branding questions when it already answers them.
2. Scaffold an appropriate local composition. Use explicit duration, source clips and local fonts/assets. Do not let initialization silently trigger transcription, downloads or provider setup.
3. Build the most visible settled layout first. Check text fit and safe margins before adding motion.
4. Animate with a registered, seekable GSAP timeline, explicit times/labels, durations and easing. Avoid wall-clock timers, randomness without a seed and animation that depends on prior playback.
5. Run `lint`, runtime `validate` and layout `inspect`. Inspect at the opening, maximum motion, settled state and ending; use denser samples for short transitions. Fix cropped words and text escaping its graphic/container.
6. Use `snapshot`, `keyframes` and `compare` to examine timed variants. Render a low-cost local preview first; inspect/probe it before retaining an asset.
7. Export the appropriate format only after its alpha/codec support is checked on both the renderer and CapCut. Transparent WebM is available in HyperFrames; actual CapCut compatibility remains a separate check.

```text
hyperframes lint --json
hyperframes validate --help
hyperframes inspect --at 0,0.15,0.3,1.5 --json
hyperframes media-treatment --capabilities --json
hyperframes media-treatment --capability retro-glitch --json
hyperframes render --quality draft --workers 1 --format webm --output overlay.webm
```

The researched CLI has discoverable media-treatment families including correction, color grading, finishing, optical essentials, retro/glitch, print, art, palettes and animation. Query the detailed capability before authoring grading/effect patches; do not assume only basic transform animation exists.

Start with one render worker on low-memory machines. Keep remote URLs, fonts and CDN scripts out of a supposedly offline render. GSAP timeline design does not automatically translate to native curves: retain the mapping and compare timed output. Review the applicable GSAP license for the app's distribution/use; no license purchase is authorized.

## Remotion

Use only when the user's use qualifies for the applicable no-cost license and the local browser/runtime is verified. Installation alone is not license eligibility. Keep its CLI/React packages at matching versions.

Use frame-index-based composition, local media references, explicit dimensions/FPS/duration and deterministic interpolation. Query `compositions`, inspect Studio or `still` samples, then use local `render` when required. Keep React components/props and timing data. Do not call Lambda/Cloud Run or paid integrations. A Remotion MP4 is not a native CapCut timeline.

Sources: https://github.com/heygen-com/hyperframes ; https://gsap.com/docs/v3/GSAP/Timeline/ ; https://gsap.com/community/standard-license/ ; https://www.remotion.dev/docs/cli ; https://www.remotion.dev/docs/license
