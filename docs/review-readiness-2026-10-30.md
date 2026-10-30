# Review readiness and media registration — 30 October 2026

## Confirmed failure

The reported Trial101 zoom had two independent assessments marked `ready`, no defects, and matched motion. Both also placed general native-playback/audio-listening caveats in `unknowns`. The controller correctly treated every unknown as blocking, but the worker contract had not distinguished those caveats from missing required evidence. The UI consequently disabled Apply despite the successful technique comparison.

The candidate also referenced its uploaded video in the job folder and had no imported-media registration. The CLI reported these as informational findings. They needed concrete packaging/registration work rather than a blanket instruction to ignore warnings.

## Change

- Reviewers use an allowlisted `limitations` field for non-blocking native-playback and perceptual-listening scope notes. `unknowns`, failed techniques, missing resources, failed host checks and defects remain blocking.
- A contradictory ready assessment receives one bounded clarification using the same evidence. Repeated contradictions remain blocked; the application never rewrites a failed review into success.
- The compiler packages newly introduced job media into candidate assets and plans its imported-media registration before preview/review. Exact source-byte checks permit copied footage while rejecting flattened substitutes.
- Timeline and registry changes use the CLI's atomic `saveDraft.additionalFiles` transaction. Existing media/metadata entries remain preserved. A stale registry rejects the save.
- Apply packages new resources from earlier stages of a multi-clip edit into the final destination too. Media must survive removal of job/staging folders.
- The UI separates **Review scope · information only** from **Unresolved verification**. A ready file-and-preview review enables the normal approval flow.

## Validation

Windows regression run: 194 discovered, 192 passed, two platform-specific skips. Lint and production build passed. Targeted review covered preview-path acceptance, embedded timeline metadata, stale-registry rejection, source identity and a two-candidate commit followed by deleting temporary resources. A headless UI test confirmed scope notes do not disable Apply and no desktop-opening request is made. Existing broad filesystem tracing warnings remain in the build.

A fresh application trial used its authenticated HTTP workflow, a disposable local project and the same 10.471667-second source. Astra built the native zoom through the local MCP; both independent reviewers returned ready with empty unknowns/defects and native playback in limitations. The application reached approval and Apply completed successfully. Read-back verified editable X/Y scale curves from 1.0 to 1.3, unchanged duration/audio gain, byte-identical packaged footage and registry entries pointing to final project files. Trial101's full directory hash remained unchanged. Local evidence: `.local-tools/preview-probe/review-readiness-system.json`; job `e3ebcd83-da13-4be4-8694-3e75410cec04`. The temporary validation server was stopped afterward; CapCut was never opened or closed.

These checks do not establish CapCut 18.2 compatibility. Its upstream version boundary remains enforced. Normal editing does not open, close, capture or export CapCut. The user still approves the reviewed revision; conflicts and failed validation remain protected by the existing backup/journal workflow.

## Retest

Update and restart AI-Editor, then run the requested edit again on a disposable project. The old blocked result retains its original assessment. Watch the new preview; when file/preview checks pass, Apply saves to the selected project. Close CapCut yourself before Apply, then open the saved project yourself to inspect the native controls.
