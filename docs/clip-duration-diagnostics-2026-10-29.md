# Clip preparation and downloadable diagnostics — 29 October 2026

The Mac tester's screenshots show preparation stopping before any AI editing session with “The extracted clip did not match its timeline duration.” The screenshots do not contain the measured duration or source probe, so they do not establish the exact cause for that file.

## Reproduced defect and repair

The previous extraction inherited the source's frame rate, then compared the MP4 container duration against the CapCut interval with a fixed 100 ms allowance. A disposable 5 FPS source reproduces the failure: a 2.21-second timeline interval produces a 2.40-second working file because its last video frame spans a longer interval.

The controller now prepares that working file at the project's frame rate, then checks both its video-stream duration and container duration. The allowance is one project frame plus 25 ms for audio packet quantization. A genuinely short source still fails; the app does not pad missing footage to pass the check. Preparation is isolated in `src/server/editing/clip-extraction.mjs`; native project writes and approval remain in their existing services. Original media files and selected timeline values are not modified during preparation.

The service records source and prepared stream duration, start time, average/nominal FPS, time base, frame counts, audio layout and the source/target interval in a job-local `clip-extraction-report.json`. Failure messages show expected/prepared durations and tolerance. This replaces the previous message without numbers.

## What the tester does

1. Update the app and restart it.
2. Retry the same selected-clip 100%–130% zoom request.
3. If preparation fails, click **Download diagnostics** in Editing progress and send that JSON report. The app selects the current run automatically; no job-ID lookup, FFprobe command or draft-file inspection is required.

**Show diagnostic details** now includes structured measurements and redacted stack frames. Downloaded reports contain runtime/failure information without the prompt, full transcript, media or original media paths. Generic error prose stays in the local app because it can quote requested captions; the export uses safe failure classifications. Known credential patterns and local home/workspace prefixes are redacted. Older failed runs cannot recover measurements that were never saved; the report explains when a retry is needed.

## Verification

`pnpm test:clips` runs the focused extraction/diagnostic regressions and is also included in `pnpm test`.

Disposable tests cover low FPS, variable FPS, fractional project FPS, constant-speed/reverse preparation, audio presence, unchanged original bytes/timing, rejection of materially missing footage, and diagnostic redaction. The low-FPS working clip is passed through the application's real controlled compiler: both native scale-axis curves retain editable 1.0 and 1.3 endpoints over the original 2.21-second timeline, with no text or effect tracks.

A Windows browser trial used a disposable project with a deliberately short source. **Run** displayed expected 2.000000s / prepared 1.000000s, diagnostic mode showed the structured report, and **Download diagnostics** saved the expected JSON. Anonymous download returned 401, cross-origin access returned 403 and an authenticated download returned 200. The fixture draft/media hashes remained unchanged, and no AI editing worker or CapCut desktop operation was started for the failing preparation.

All 140 Node tests were discovered on Windows: 139 passed and the POSIX-only test skipped. Lint and the production build including TypeScript passed. Existing Node module-type and broad build-tracing warnings remain. Evidence is retained under `.local-tools/preview-probe/mac-clip-*` and `diagnostics-ui-receipt.json`. These checks reproduce and repair a preparation defect; the tester's exact Mac media and native playback still require the next app run.
# Follow-up from the Mac audit — 2026-10-30

The returned `CLIP_DURATION_AUDIT.md` now provides measurements from the affected Mac run. Its selected source interval and target interval both request **15.866666 seconds** at 1× playback. The linked video's container and video stream both report **10.471667 seconds**, and its audio reports 10.471179 seconds. The prepared video is 10.533333 seconds. This is materially missing footage, separate from the low-FPS issue reproduced above.

The existing duration rejection is correct for that input. A model change cannot supply the missing source frames. The report does not establish why the timeline points to a shorter file: stale timing, a replaced/relinked file and material/timeline mapping remain hypotheses. No timeranges, playback speed, source mapping or duration tolerances were changed in response to this audit.

For the next test, use the new CapCut project and different footage the tester is already preparing. Save the project in CapCut, refresh projects in AI-Editor, select the clip and repeat the native 100%–130% zoom request. To reuse the affected project, first relink the intended full-length file or correct the clip's range in CapCut. If another failure occurs, use **Download diagnostics** on the new run. There is no need to look up a job ID or run media commands.

The application's lead editing agent now uses **GPT-6 Astra**, with the existing medium reasoning default and standard speed settings. The existing bounded high-reasoning escalation remains available for a correction. The worker, workspace model label and job result model read the same public configuration. Specialist/reviewer models and security/evidence gates are unchanged. This changes new app jobs after restart, independently of the development chat's model. See [Codex model selection](https://learn.chatgpt.com/docs/models) for the official `gpt-6-astra` CLI identifier; account availability is checked by the app before each worker starts.

The signed-in account on the Windows test host listed Astra with medium reasoning support. A disposable live Astra/local-MCP trial successfully called `inspect_job`, `evaluate_keyframes`, `apply_edit_plan` and `inspect_timeline`. Read-back confirmed separate native X/Y scale curves with 100%, 130% and 110% values at 0, 0.20 and 0.35 seconds. The protected fixture file remained unchanged. This confirms the selected model can author and inspect native keyframes through the local tools; it does not establish native playback quality or repair the mismatched Mac source. Evidence is retained in `.local-tools/preview-probe/astra-availability-2026-10-30.json` and `astra-native-keyframes-2026-10-30.json`.
