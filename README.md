# AI Video Editor

A local Next.js helper that edits a selected CapCut timeline clip or populates an empty project from raw footage and a reference video. Codex CLI analyzes the current reference and prompt on each Run, creates a timed CapCut edit, and streams its full transcript into the app.

## Start

```powershell
pnpm install
pnpm dev
```

Open `http://localhost:3000`. First launch installs the local FFmpeg, Remotion, and HyperFrames toolchain. Sign in to Codex CLI with your ChatGPT account (`codex login`); this workflow does not require an OpenAI API key. Groq remains optional.

## Edit a video

1. Save your project in CapCut, then close CapCut.
2. Select the project in the app. For a populated timeline, choose a video clip using its thumbnail, filename, track, and timeline position. For an empty project, attach raw footage. Add a reference video or image.
3. Describe what to copy or change, then click **Run**. Codex inspects the reference and target, plans the edit, and writes media layers and native operations into the selected project. The conversation and tool commands appear in the live transcript.
4. Open the project in CapCut and review the timeline and visual result. The app backs up the empty project before writing. If planning or validation fails, it does not claim the edit was applied.
5. Click **Save recipe** to keep the complete edit for reuse. Recipes are not saved automatically. Choosing a recipe on a later Run reuses its reference and prompt, then builds a new edit for new raw footage.

For an existing timeline, Run updates only the selected clip and adds generated layers at its timeline position. It preserves the other clips, audio, and project duration. The visible source range is normalized before editing, so constant speed and trims are supported; speed curves are refused. Scene-wide effects must be rendered on clip layers to avoid affecting overlapping footage. The app validates a staged draft before writing, but CapCut remains the final visual review. Some complex effects are separate rendered media layers rather than individually adjustable CapCut controls.

## Layout

- `src/app/keyframe-helper.tsx`: raw/reference workflow and live Codex transcript.
- `src/lib/native-capcut.ts`: per-run edit planning, asset validation, staged compile, backup, and draft write.
- `scripts/merge-clip-edit.mjs`: merges the selected clip's edit and offsets its generated layers without rebuilding the surrounding timeline.
- `src/lib/edit-jobs.ts`: job progress and explicitly saved whole-edit recipes.
- `src/lib/reference-analysis.ts`: ChatGPT-signed-in Codex CLI launch and transcript capture.
- `toolchain/`: CapCut CLI, Remotion, HyperFrames, and their installed dependencies.
- `.local-tools/`: downloaded binaries, job assets, transcripts, and backups. This folder is local and Git-ignored.
