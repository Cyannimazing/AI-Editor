# Reference editing workflow

Start at [the AI context index](../ai/README.md). The controller enforces permissions, deadlines, account selection, evidence checks and commits. AI roles cannot relax those rules.

## Analyze and build

Startup prepares the installed tool inventory and validates `ai/context-index.json`. Each worker receives its selected editing guides, installed capabilities and a hashed context manifest through `roles.ts`. Read the request and this tool context first. Record technique IDs, timestamps, measurements, evidence, confidence and unknowns in `reference-analysis.json`. Build prompts now include contact-sheet frame timestamps and sampling/audio metadata. Analyze short transitions densely. For instruction-only jobs, label criteria as requested rather than observed. Image evidence cannot certify audio.

One editor integrates changes. Relevant motion, caption and audio specialists run in separate sessions; visual reviewer and manager use independent sessions and model policies.

Workers use a job-bound local MCP server to inspect timed frames, evaluate keyframes and inspect the saved timeline. Only the lead may call the validated candidate-build tool. Final plans remain structured JSON, and trusted application code performs all writes. The Codex tool host is enabled; shell/patch, unrelated integrations and desktop operations remain denied. Independent roles cannot edit. No tool accepts arbitrary destinations or permits installing packages, reading credentials, uploading media, spending credits or committing originals. See [the MCP investigation](local-mcp-editing-research.md).

References transfer techniques onto the current footage; they are not scene-cloning targets. Establish a filled picture before keyframe animation. New raw projects can remove stable encoded edge padding from retained working copies. Review timing, direction, intensity, easing, overshoot/rebound and graphic attachment; do not penalize different subjects/scenery for lacking identical pixels.

Preserve the selected interval, unrelated tracks/materials, source footage, canvas, frame rate and native editable controls. Retain build sources. Report unsupported techniques rather than omitting them. Never flatten promised editable words, effects or motion into replacement video.

The structured v4 contract compiles source/text controls, complete native motion/color curves, generated vector/source-frame assets, independent image/source overlay layers, blend controls and clip/layer-bound catalog effects. Native text includes installed font selection and bold/italic styling. Each requested technique maps to specific components and timed acceptance criteria. The planner can request official CapCut material queries; the controller supplies results before compiling the same build round. Generated assets retain their sources and reuse checked content-addressed cache entries.

Relevant motion/caption/audio specialists run independently before the lead integrates the plan. Local FFmpeg measurements provide stream/loudness/silence evidence; they do not establish words or sound identity. HyperFrames/GSAP renders the serialized native curves locally, with lint, validation and timed layout inspection. The visual reviewer and manager each assess every technique. Their defects are combined and drive bounded repairs; last-round defects cannot turn into success. Current native effect and audio-curve preview omissions are reported explicitly. General cuts/retiming, filters/masks/transitions, local ASR/TTS setup and automatic native verification remain separate integration work. See `cli-tool-research.md`.

## Review and correct

Run structural/path checks and prepare a preview. Separate reviewer and manager sessions return precise defects, timestamps, affected components and evidence. Recheck affected dependencies after each correction.

Allow one build plus at most three corrections within 30 minutes. Stop on repeated identical failure or unavailable account/model/security capabilities. Standard speed is used, with one permitted high-reasoning Sol escalation. Usage savings remain unmeasured.

The trusted native adapter opens the exact candidate, inspects editable controls and captures its player at checked timeline positions, binding evidence to revision and platform/CapCut version. Normal jobs never export. Missing player/audio evidence and unsupported layouts remain unverified. See `native-player-verification.md` for current platform scope.

## Approve and commit

Require explicit approval of the exact verified digest. Check the original is unchanged, acquire the lock, close CapCut gracefully and create a complete backup before writing. Journal each commit phase and validate the saved result.

On failure, restore the whole directory so candidate-only files cannot survive. Interrupted commit/restore journals block later writes until recovery is inspected. Automatic continuation from every possible crash checkpoint remains unfinished.

Save reusable recipes only after successful review/commit and the user's Save action. They are internal method/evidence snapshots, not portable CapCut presets.
