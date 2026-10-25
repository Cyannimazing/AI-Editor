# Reference editing workflow

The editing agent is GPT-6.1 Sol (`gpt-6.1-sol`) through the signed-in ChatGPT Codex CLI. It runs with Full Access, including local shell, network access and no approval prompts. Keep the local HTTP endpoints restricted to localhost. Full Access does not change the selected project's edit scope.

## Analyze before building

Watch the entire supplied reference in order, with audio. A screenshot or three representative frames cannot describe a fast transition. For short references, inspect every frame, especially the first frames. For longer references, inspect the full overview and then extract consecutive frames around every cut, entrance, transition and ending. Never infer an animation from its resting frame.

Write `reference-analysis.json` in the job directory. Include the reference's dimensions, frame rate, duration, picture bounds, words, font appearance, text-to-graphic proportions, positions, timings and uncertainty. Each technique needs an ID, start/end times, observed evidence, measurements and confidence. Separate camera/subject movement from digital transforms by tracking background landmarks and subject pose. Distinguish a freeze frame from a live subject. Measure overshoot, zoom direction, rotation, easing, color/channel offsets, brightness changes, motion trails, blur and sound timing. Do not add techniques absent from this reference. User instructions may narrow the requested techniques.

## Use the toolchain

Verify the local tools before using them and read their installed documentation. Install missing dependencies in `toolchain/`, retaining build sources in the job. Use Remotion for motion design and frame-by-frame transforms; translate the motion into CapCut keyframes. Use HyperFrames for captions and graphics; preserve editable text separately from the graphic. Use FFmpeg/FFprobe for frames, cuts, source normalization, freezes, analysis and sound mixes. Tools without a relevant task need not run. Report commands and files actually used. Do not use an image generator or CapCut's AI Edit panels to substitute for editing.

## Build an editable native candidate

Edit the candidate copy only. Retain the selected clip's global timing, surrounding clips/audio, canvas, original transforms and project metadata. Work from the target footage; reference media supplies style, not replacement footage or soundtrack. Save `native-edit.mjs` and any other repeatable build sources alongside the analysis. Keep generated assets in the job directory. Never embed an entire finished MP4, bake editable words into a graphic, or disguise baked effects as editable controls.

Use native text, transform keyframes, real effect materials and compounds. A cloud/text group should have a sharp static cloud and editable text inside the same compound, with its entrance motion/effect applied to the parent. Smear only during the measured movement. The resting graphic must be sharp and have no lingering blur resource. Native freeze frames may use an unprocessed source still, with zoom/position left as native controls.

CapCut formats are version dependent. Inspect the installed version and actual candidate schema. These observations from the manual edit are calibration clues, not universal constants:

- Explicit `KFTypeScaleX` and `KFTypeScaleY` worked where `UNIFORM_SCALE` was ignored. Check both axes in native playback.
- A measured pixel offset used `x = 2*dx/canvasWidth`, `y = -2*dy/canvasHeight`. Verify coordinate direction, picture bounds and crop for the actual project.
- Native text size differed from the CLI proxy. An initial estimate was `pixelSize*320/canvasHeight`; calibrate text ink width, height and its ratio to the graphic in the actual CapCut preview. Do not reuse the prior clip's numeric font size.
- An effect name/ID without its real bundle was a no-op. Verify downloaded resource files, shader/Lua metadata, native references and visible output. Do not commit or redistribute provider binaries, fonts or cached bundles to Git.
- Global effects colored overlays and letterboxing incorrectly. Use actual source-scoped effects on the real main track, or isolate the affected source in a native compound. A guessed `bind_segment_id` alone is not proof of scope.
- Animation clocks sometimes stayed at zero during native seeks. If an effect is static or missing, use explicit native parameter keyframes or frame-aligned native effect/compound segments with fixed phases. Derive the phases from the current reference. End the blur segments before the sharp rest state. Do not replace this with a preblurred cloud or baked video.
- Native compounds used a proxy video material (`extra_type_option: 2`), a `type: combination` material in `materials.drafts`, and the combination reference in the parent's `extra_material_refs`. Keep the embedded child, `subdraft/<id>/draft_content.json` and `sub_draft_config.json` consistent. Inspect an app-authored structure for the current version instead of inventing fields.
- Keep the actual main track's flags and order. Resolve the active timeline through `Timelines/project.json`. Keep root, active timeline and subdraft mirrors consistent. Resolve known draft-path placeholders against the candidate project and check that every dependency exists.

## Compare, close, revise

Close CapCut before changing any candidate draft file. Open the candidate only after the write finishes. Use available computer-use tools or a real native export adapter to inspect CapCut's own output. Inspect native editable controls as well as appearance. Record playback across the whole target interval, including audio if present, as a native playback/export video. Compare matching moments against the actual reference frames, including the first and last frames, transition peaks, overshoots and settled text/graphics. Capture native preview images at those points. A FFmpeg/Remotion proxy is useful for design but never proves native effects work.

Close CapCut after review. Write the review report only after the candidate has finished saving; obtain its digest with the supplied draft helper. Keep review evidence inside the current review directory. Report each technique's measured mismatch and exact next correction. The host runs another build/review iteration when mismatches remain. Never mark a match if an effect is missing, text size is wrong, blur persists at rest, or native playback could not be inspected. The host requires matching technique reports, opening/ending evidence, native playback media and a matching candidate digest before committing.

The loop has a finite iteration budget and can be cancelled. Failure, missing native review capability or budget exhaustion leaves the user's project unchanged. On success, close CapCut, back up the selected project, commit the verified candidate, and reopen the final project for the user. Save the analysis, prompts, build sources, comparison history and evidence with a named skill only when requested through Save skill. Reuse the technique recipe with the new footage, regenerating footage-dependent assets and measurements.
