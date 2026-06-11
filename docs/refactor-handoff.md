# AO Refactor — Handoff & Resume Guide

> **Resume point**: start here on fresh checkout.
> **Last saved commit**: `6d1a247e` (docs: add dynamic personality adaptation to future experiment notes)
> **Branch**: `feat/multi-worker`
> **Core typecheck status**: passing (`pnpm --dir packages/core typecheck` clean)
> **Date**: 2026-06-11

---

## What Was Done (Committed)

| Commit | Scope | Status |
|--------|-------|--------|
| `46a7587f` | Decompose types.ts, extract probe-strategy, fix metadata imports, resolve web-vitals | Committed, fully typechecking and building |
| `4498c17b` | `sideEffects: false` for all 27 plugin packages | Committed, reduces bundle surface |
| `24501b75` | `docs/multi-agent-orchestration-architecture.md` + `orchestrator-intelligence.ts` + `orchestrator-types.ts` | Committed, typecheck passes |
| `fcfb3e11` | Appendix A & B added to architecture doc (personality/memory layer + inter-agent messaging experiment) | Committed |
| `6d1a247e` | Dynamic personality adaptation note in doc | Committed |
| `169628a7` | Restart instructions block at top of doc | Committed |

### Files Added (committed)

- `docs/multi-agent-orchestration-architecture.md`
- `packages/core/src/orchestrator-intelligence.ts`
- `packages/core/src/orchestrator-types.ts`
- `packages/core/src/config-types.ts`
- `packages/core/src/errors.ts`
- `packages/core/src/plugin-types.ts`
- `packages/core/src/portfolio-types.ts`
- `packages/core/src/probe-strategy.ts`
- `packages/core/src/session-types.ts`
- `packages/web/src/hooks/useWebVitals.ts`

### Files Modified (committed)

- 27 x `packages/plugins/*/package.json` (sideEffects)
- `packages/web/src/app/api/observability/route.ts`
- `packages/core/rollup.config.ts`
- `packages/core/src/lifecycle-manager.ts`
- `packages/core/src/metadata.ts`
- `packages/core/src/session-manager.ts`
- `packages/core/src/types.ts`
- `packages/web/package.json`

---

## What Is Left (TODO)

### High priority (do first)

1. **[x] Probe Strategy extraction**
   - Moved probe helpers from `packages/core/src/lifecycle-manager.ts` → `packages/core/src/probe-strategy.ts`
   - Kept `determineStatus()` readable and lifecycle logic unchanged
   - Verified: `pnpm --dir packages/core typecheck` passes cleanly

2. **[x] Metadata repair consolidation**
   - Moved metadata repair helpers from `session-manager.ts` → `metadata.ts`
   - Updated imports in `session-manager.ts` only; kept call sites unchanged
   - Verified: `pnpm --dir packages/core typecheck` passes cleanly

### Medium priority

3. **[x] `types.ts` decomposition (safe, additive)**
   - Decomposed monolithic `types.ts` into domain-specific sub-files (`config-types.ts`, `plugin-types.ts`, `session-types.ts`, `portfolio-types.ts`, `errors.ts`).
   - Re-exported all types from `types.ts` to maintain 100% backward compatibility for downstream consumer packages.
   - Configured `types` as an entry point in `packages/core/rollup.config.ts`.
   - Verified: Workspace typecheck and build pass cleanly.

4. **[x] Docs Section: “Type Split + Probe Strategy”**
   - Added Appendix C to `docs/multi-agent-orchestration-architecture.md` outlining the layout, motivation, import guidelines, and strategy isolation.

### Low priority / polish

5. **[x] Dashboard observability wiring**
   - Resolved typecheck issue by importing `web-vitals` and declaring `useWebVitals()` client hook.
   - Verified alignment with observability routes.

6. **[ ] Changelog update**
   - Summarize final refactoring milestones in `CHANGELOG.md` or similar if appropriate.

---

## How To Resume (Step by Step)

### 1. Baseline check

```bash
git status --short
git log --oneline -5
pnpm --dir packages/core typecheck
pnpm typecheck   # workspace root, optional but recommended
```

All three should be clean / passing.

### 2. Pick one TODO item

Work on **only one** item at a time.

### 3. Make the smallest possible change

- One file move / one helper extraction per commit
- No cross-cutting renames
- No changes to `index.ts` public exports unless absolutely required

### 4. Verify immediately

```bash
pnpm --dir packages/core typecheck
```

### 5. Commit with conventional message

```
git add <files>
git commit -m "<type>(<scope>): <short summary>"
```

Types to use: `feat`, `fix`, `refactor`, `docs`, `chore`, `test`

### 6. Update this handoff doc

After each commit:
- Add the commit hash to the “What Was Done” table
- Cross off the matching TODO item
- Note any new problems discovered

---

## Guardrails

- **Never** edit files inside `.git/`
- **Never** introduce `process.platform === "win32"` inline; use `isWindows()` from `@aoagents/ao-core`
- **Never** change `packages/core/src/index.ts` public surface without discussion
- **Never** push to remote unless explicitly asked
- **Always** keep `pnpm --dir packages/core typecheck` passing before moving to the next item

---

## Branch & Remote Notes

- Remote: `origin`
- Branch: `feat/multi-worker`
- Do NOT push unless explicitly requested
- If creating a follow-up branch, base it off current HEAD to avoid drift

---

## Known Risks / Watch Items

- `config-types.ts` currently duplicates some symbols already in `types.ts` (config split was partially reverted/fixed during this session). Keep it additive.
- `packages/core/src/orchestrator-intelligence.ts` is a stub engine; it compiles but is not wired into lifecycle yet.
- `probe-strategy.ts` exists as an idea file only; actual extraction still pending.
- `session-manager.ts` and `lifecycle-manager.ts` remain large (>3000 lines each). Further splitting them is not in scope unless asked.

---

## Quick Reference Commands

```bash
pnpm install
pnpm build
pnpm typecheck
pnpm test
pnpm lint
```

Core-only faster loop:

```bash
pnpm --dir packages/core typecheck
pnpm --dir packages/core test
```

---

*End of handoff guide.*
