# Project editing scope implementation plan

**Goal:** Select an existing project as the save destination, run from a prompt without selecting a clip, or narrow the job with a named clip checklist.

**Architecture:** Keep one controller lock and one final approval/transaction for the selected project. A read-only planning step distributes the request across allowed video clips, with explicit reasons for untouched clips and unsupported operations. Build clip changes sequentially into one accumulated candidate. Validate every selected ID against the current snapshot. Verify the final accumulated revision, never approve an earlier intermediate revision. Existing project content outside each scoped operation remains protected.

**Scope:** The current active timeline is the project editing surface. Existing video clips are eligible; existing text/audio/layer structure is visible as context and preserved. Unsupported edits to existing non-video components or cross-clip duration/reordering must be reported, not silently approximated. Empty timelines still require footage. References remain optional. Windows/macOS use the same controller and existing platform adapters.

**User flow:** Project → Entire project (default) / Selected clips → prompt and optional reference → review → Apply to [project name]. Clip rows show filename, track, time range. The original project is the destination; internal candidates/review copies protect it until approval. No paid calls or uploads.

## Tasks

- [x] Add scope/request and planner validation contracts with tests for stale IDs, duplicates, empty selection, legacy single-clip requests and out-of-scope routing.
- [x] Add project planning and sequential candidate orchestration; keep all work inside one job deadline and commit only the final candidate. Test accumulation, preservation and all-or-nothing approval eligibility.
- [x] Add final-revision verification for multi-clip candidates. Bind every per-clip receipt to the final digest and recheck them on approval.
- [x] Wire multipart API, clear selection controls/names, destination-aware approval and temporary review labels.
- [x] Run tests, lint, build and disposable application/API/UI checks. Record evidence and remaining native acceptance limits; restart localhost.

Handoff: 125 tests and five motion fixtures passed; lint/build passed. The live planner routed an opening-only instruction on a synthetic two-clip project and was cancelled with the original unchanged. Browser checks confirmed Entire project by default, a named clip checklist, disabled Run for zero checked clips, and enabled Run for both project+prompt and selected-clip+prompt without a reference. Reusable controls are absent. This is not a full multi-clip native visual acceptance run. See the independent audit response for evidence boundaries.

Implementation proceeds under the user's explicit request to make this workflow. No production project is mutated during tests, and no automatic approval is introduced.
