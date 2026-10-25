# AI Video Editor

A local Next.js helper that edits a selected CapCut timeline clip or populates an empty project from raw footage and a reference video. GPT-6.1 Sol analyzes the reference, builds native editable layers, and loops through CapCut playback comparisons and corrections before replacing the selected project's draft. The CLI conversation streams into the app.

## Start

```powershell
pnpm install
pnpm dev
```

Open `http://localhost:3000`. First launch installs the local FFmpeg, Remotion, and HyperFrames toolchain. Sign in to Codex CLI with your ChatGPT account (`codex login`); this workflow does not require an OpenAI API key. Groq remains optional.

## Edit a video

1. Save your project in CapCut. Leave the desktop available for the native review loop.
2. Select the project in the app. For a populated timeline, choose a video clip using its thumbnail, filename, track, and timeline position. For an empty project, attach raw footage. Add a reference video or image.
3. Describe what to copy or change, then click **Run**. The app closes CapCut and copies the project into an isolated review candidate. The CLI inspects the whole reference, including consecutive frames for short references, and records technique measurements. It uses Remotion for motion design, HyperFrames for captions/graphics, and FFmpeg for frames, cuts and sound mixes. Final text, motion and effects stay native and editable.
4. Each iteration builds with CapCut closed, opens the candidate for native review, compares the entire edit and closes CapCut before another revision. The loop checks text proportions, camera zooms, easing, entrance smears, sharp settled graphics, real effects and audio where present. The CLI needs working local computer-use tools or a native export adapter to perform this review; Full Access alone does not supply a native renderer. Proxy renders and draft lint cannot pass the comparison gate. If native review is unavailable or the match remains incomplete, your original project is not replaced and the candidate/feedback are retained.
5. After every technique passes, the app backs up the selected project, commits the verified candidate with CapCut closed and reopens the final project. **Cancel run** stops active analysis/tools before the final write. That short write finishes without interruption once it starts.
6. Enter your **Skill name** and click **Save skill**. Saving snapshots the plan, native manifest, workflow, reference analysis, build/review prompts and comparison history, and retains the reference, evidence and reusable build-asset locations. **Use skill** starts from those settings with new footage; footage-dependent assets are regenerated and the current prompt can override the recipe. Saving is explicit.

The app launches Codex CLI with `--model gpt-6.1-sol --dangerously-bypass-approvals-and-sandbox`, high reasoning and local shell tools. This is Full Access with network access and no approval prompts. Existing CLI configuration remains available for installed skills and relevant native computer-use tools. Authentication must use the signed-in ChatGPT account. The HTTP API remains restricted to localhost.

For an existing timeline, Run updates only the selected interval, preserving unrelated segments, shared materials, track settings, canvas, frame rate and project duration. Source splits, unprocessed freeze stills and native compounds are supported. Constant speed and trims are normalized for analysis; speed curves are refused. Source-scoped native effects or compound effects isolate processing from unrelated layers. Generated video replacements containing baked text/effects are rejected. Static graphic assets and audio mixes are supported.

The default loop budget is six build/review iterations. Set `AI_EDITOR_MAX_ITERATIONS` to an integer from 1–12 to change it. Short references up to 12 seconds receive consecutive frame extraction at up to 60fps; longer references receive an overview, with the CLI required to inspect dense transition windows. References are limited to 100 MB and ten minutes; raw uploads to 200 MB. Each job retains exact prompts, analysis, scripts, manifests, iteration feedback and native preview evidence under `.local-tools/`.

The detailed editing rules and calibration lessons from the manual workflow live in [docs/reference-editing-workflow.md](docs/reference-editing-workflow.md). They include native scale axes, font-size calibration, real effect resources, correct compound references, and explicit frame-aligned phases when native animation clocks fail. Measurements are derived from the current reference; the previous clip's words, timings and graphics are not hardcoded.

## Layout

- `src/app/keyframe-helper.tsx`: raw/reference workflow and live Codex transcript.
- `src/lib/native-capcut.ts`: source preparation, isolated candidate, backup, and verified draft commit.
- `src/lib/reference-edit-loop.ts`: build/review iterations, exact saved prompts, native evidence gate and mismatch feedback.
- `src/lib/native-edit-validation.ts`: selected-interval, unrelated-content, native asset and comparison validation.
- `src/lib/reference-media.ts`: timed frame index, contact sheets and reference audio.
- `scripts/capcut-session.mjs`: close/wait/open protocol; never force-kills a saving editor.
- `scripts/capcut-draft.mjs`: active timeline resolution, isolated review identity, draft fingerprints and native commit.
- `scripts/native-motion-tools.mjs`: axis-scale conversion, coordinate/font calibration hints and fixed frame-phase segments.
- `scripts/merge-clip-edit.mjs`: retained legacy compile/merge helper.
- `src/lib/edit-jobs.ts`: job progress and explicitly saved whole-edit recipes.
- `src/lib/cancellable-process.ts`: streams child processes and stops their Windows process tree on cancellation.
- `src/lib/edit-skill-store.ts`: named skill snapshots containing completed edit settings.
- `src/lib/reference-analysis.ts`: ChatGPT-signed-in Codex CLI launch and transcript capture.
- `toolchain/`: CapCut CLI, Remotion, HyperFrames, and their installed dependencies.
- `.local-tools/`: downloaded binaries, job assets, transcripts, and backups. This folder is local and Git-ignored.
