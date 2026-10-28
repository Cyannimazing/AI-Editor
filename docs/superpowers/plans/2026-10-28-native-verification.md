# Native CapCut verification implementation plan

**Goal:** Complete the application's local export-to-review path without approving proxy output as native evidence.

**Architecture:** The trusted controller publishes a disposable registered copy of an immutable candidate, drives the observed native export controls, validates a newly produced video, and binds evidence to the candidate hash. Both independent reviewers inspect native frames before approval. Workers retain existing restrictions.

**Scope:** Windows execution here; macOS adapter, permission guidance and contract tests. User explicitly accepts Mac-ready code with physical Mac acceptance pending.

**Alternatives:** The installed CLI export is only an experimental shortcut trigger and cannot establish completion. Cloud editing changes the delivery/storage model. Use local OS accessibility adapters with exact project checks, bounded waits, no fixed screen coordinates and no paid interactions.

- [ ] Add tests for missing/stale/mismatched exports, changed candidates, cancellation and native evidence validation.
- [ ] Implement platform drivers with observable UI states and explicit unsupported/permission errors.
- [ ] Publish and export a fresh copy; validate duration, resolution and decodability, retain provenance and enforce exclusive desktop use.
- [ ] Feed native frames into independent reviews and bounded corrections, preserving unsupported requirements and approval boundaries.
- [ ] Test disposable Windows exports and app integration. Document actual Mac limitations and permission setup.
- [ ] Run tests, lint and build; restart localhost:3000.

No permission bypass, credential handling, media upload, paid generation, mutation of originals or claim of real Mac acceptance is permitted. A failure must preserve diagnostics and the candidate without consuming visual-repair rounds for an unavailable export adapter.
