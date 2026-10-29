# Clip preparation and downloadable diagnostics — 29 October 2026

## Latest engine repair — 30 October 2026

The project reader had a reproducible duration-selection defect: it preferred `draft_content.json`, while the installed CapCut CLI can select a different modern canonical document. A disposable project with 15.866666s in an old mirror and 10.471667s in the canonical document made the app read 15.866666s. Project listing, selected-clip preparation, native compilation and commits now use the same CLI storage rules. The selected document's parsed content and raw provenance come from one snapshot, preventing an autosave from mixing two revisions. A selected clip retains its own range even when the complete project is longer.

Constant-speed handling also needed correction. A missing source duration now uses the explicit native playback speed. A default source range that was not retimed may be interpreted from an explicit non-unit speed only when that interpretation fits the actual media. The engine does not derive a new speed from file length. Conflicting source/speed data, duplicate clip/material IDs and multiple referenced speed records are rejected before extraction. Genuinely short source intervals receive `SOURCE_INTERVAL_EXCEEDS_MEDIA` before FFmpeg writes a working video. Reports distinguish serialized and effective ranges/speeds and include hashed document, timeline, track, clip, material and source-path identity without exposing local paths.

The source video supplied on the Desktop was probed read-only and matches the Mac audit: 10.471667s and 315 frames. A disposable trial through the engine's extraction/compiler services produced a 10.5s CFR working copy and an exact **10.471667s native candidate**, with separate editable X/Y scale keyframes from 100% to 130%, an audio stream and an unchanged original SHA-256. It did not open CapCut or change a personal project. Receipt: `.local-tools/preview-probe/duration-audit-source-trial.json`.

A second trial exercised selected-project resolution as well: a disposable project's stale mirror contained 15.866666s while its canonical document and selected clip contained 10.471667s. The app selected `template-2.tmp`, prepared the supplied video and merged native X/Y 100%–130% keyframes into the selected segment at exactly 10471667µs. Both source-project documents and the supplied video retained their original hashes. Receipt: `.local-tools/preview-probe/timing-selected-clip-trial.json`. These are engine-service/compiler trials, without AI design or native desktop playback.

The installed CLI's factory creates a neutral 1× speed companion; its compiler can retime `segment.speed` without changing that companion. The extractor respects the segment's explicit speed in that case. Multiple speed records and conflicting non-neutral speeds remain ambiguous. Timing diagnostics keep numeric fields only, preventing malformed project metadata from inserting arbitrary private text into a shared report.

This proves and repairs engine defects that can produce the reported class of mismatch. The failed Mac project's serialized documents have not been supplied, so the audit alone cannot prove which defect was present in that particular project. Retry the **existing selected project/clip** after updating and restarting. If preparation still fails, send the new **Download diagnostics** report; it now identifies the exact canonical document and timing interpretation. There is no need to replace the footage merely to work around an app-reader defect.

The sections below retain the earlier investigation and its evidence limits.

Release checks for this repair: **153 tests passed, one POSIX-only skip**, lint and production/TypeScript build passed on Windows. The code paths use the shared Windows/macOS Node and CLI adapters. These checks and engine-service trials do not constitute Mac desktop playback acceptance.

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
