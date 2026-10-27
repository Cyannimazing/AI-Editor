<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## AI-Editor architecture

Start at `ai/README.md`, `ai/contract.md` and `docs/audit-remediation.md`.
Before changing editing behavior, read `ai/workflows/editing.md` and the relevant tool guides selected by `ai/context-index.json`. Use `pnpm tools:inspect` to learn the installed CLI contracts and versions. Consult actual command help/source before inventing options. Treat required generated assets as a build step, and editing techniques as combinations of native controls, layers, keyframes, cuts, effects and audio rather than a fixed preset list. Distinguish application adapter gaps from CLI capabilities. App workers load these instructions through `src/server/codex/roles.ts`; changing AGENTS.md alone does not update worker context because their automatic project-doc loading is disabled.
Keep API routes thin. Authentication, setup, platform support, Codex, editing and CapCut concerns belong in their respective `src/server/` modules. UI status must distinguish installation, authorization, approximate preview and native verification.

Workers must not change originals, control the desktop, install dependencies, upload media or use paid services. The controller owns approval and commits. Preserve Codex account-only authentication. Failed security/evidence gates block editing/release; never add an unrestricted fallback to make checks pass.

Use disposable fixtures, never real personal projects, for automated mutation tests. Run relevant tests, lint and build before handoff. Distinguish code checks from real Windows/macOS acceptance.
