# AI Video Editor

A local Next.js helper that edits an existing empty CapCut project from raw footage and a reference video. Codex CLI analyzes the current reference and prompt on each Run, creates a timed CapCut edit, and streams its full transcript into the app.

## Start

```powershell
pnpm install
pnpm dev
```

Open `http://localhost:3000`. First launch installs the local FFmpeg, Remotion, and HyperFrames toolchain. Sign in to Codex CLI with your ChatGPT account (`codex login`); this workflow does not require an OpenAI API key. Groq remains optional.

## Edit a video

1. Create an empty project in CapCut, then close CapCut.
2. Select that project in the app. Attach the raw footage and a reference video or image.
3. Describe what to copy or change, then click **Run**. Codex inspects the reference and target, plans the edit, and writes media layers and native operations into the selected project. The conversation and tool commands appear in the live transcript.
4. Open the project in CapCut and review the timeline and visual result. The app backs up the empty project before writing. If planning or validation fails, it does not claim the edit was applied.
5. Click **Save recipe** to keep the complete edit for reuse. Recipes are not saved automatically. Choosing a recipe on a later Run reuses its reference and prompt, then builds a new edit for new raw footage.

The selected CapCut project must have an empty timeline. Run refuses to overwrite existing timeline edits. The app can check the staged draft structure, but CapCut remains the final visual review. Some complex effects are separate rendered media layers rather than individually adjustable CapCut controls.

## Layout

- `src/app/keyframe-helper.tsx`: raw/reference workflow and live Codex transcript.
- `src/lib/native-capcut.ts`: per-run edit planning, asset validation, staged compile, backup, and draft write.
- `src/lib/edit-jobs.ts`: job progress and explicitly saved whole-edit recipes.
- `src/lib/reference-analysis.ts`: ChatGPT-signed-in Codex CLI launch and transcript capture.
- `toolchain/`: CapCut CLI, Remotion, HyperFrames, and their installed dependencies.
- `.local-tools/`: downloaded binaries, job assets, transcripts, and backups. This folder is local and Git-ignored.
