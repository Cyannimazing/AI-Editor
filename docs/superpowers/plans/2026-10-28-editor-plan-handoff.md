# Saved Editor Plan Handoff Implementation Plan

> **For agentic workers:** Use executing-plans to implement and verify each step in this shared checkout; do not alter running jobs or original projects.

**Goal:** Avoid emitting a complete editing plan twice after the local MCP builder has already saved it.

**Architecture:** The editor returns a strict envelope containing either a successful build hash or a full unbuilt plan. The controller resolves the hash against its job-local saved plan, then runs all existing plan, scope, compilation, resource and quality checks. No hash is a quality pass.

**Tech Stack:** Existing Node modules, JSON Schema, Codex CLI structured output and node:test.

**Spec:** The observed Reference Video 1 app run emitted a large plan through `apply_edit_plan`, then repeated the full JSON as the terminal response. The user requested engine-led editing with controlled usage. Reuse is restricted to the current job's latest successful build; failed builds must not become handoffs.

## Constraints and review focus

- No original writes, worker shell permissions, uploads or paid services.
- Reject wrong hashes, malformed envelopes, both branches, missing files and oversized payloads.
- Full-plan fallback preserves reporting of plans the worker could not build.
- Resolve before specialists read `controlled-plan-N.json`; they continue to receive the complete plan.
- Native comparison, approval and the 30-minute deadline remain unchanged.

## Tasks

- [x] Add `src/server/editing/editor-plan-result.mjs` with an envelope schema and strict resolver. Test stale hashes, exact saved content, malformed branches, size limits and full-plan fallback.
- [x] Update the two editor invocations in `src/lib/reference-edit-loop.ts` to use the envelope schema, resolve it and persist the full controlled plan before downstream work. Update editor instructions.
- [ ] Run relevant tests, lint, TypeScript and build. Test a disposable app job; distinguish a successful handoff from native quality acceptance. Record timing without claiming measured usage savings prematurely.
