# Final Install-Readiness Audit

> **Audit only.** This document records whether the current `main` is a
> *final-install candidate*. It adds no feature, changes no behavior, and
> performs no install / tag / release / asset upload. **install freeze + release
> freeze remain in force.**

- **Date:** 2026-06-26
- **Audited commit (pre-audit main):** `7c862da`
- **Version:** `5.0.0` (not bumped — frozen; main carries unreleased experimental
  additions on top of the v5.0.0 release point)
- **Audit branch:** `audit/final-install-readiness`

## 1. Current main

`origin/main = 7c862da` — `feat(m4b): read-only agent_graph_preview diagnostic
entry on self_learning_control`. The v5.1 experimental sequence
(M5c → M1-defer → M5d → M4a → M4b) plus M5/M5b are all merged.

## 2. Completed modules (shipped on main)

| Module | What | Default | Side effects |
|---|---|---|---|
| **v5.0.0 core** (M0/M2/M3-lite/M6) | build/dist, default-off LLM extraction, task-bus background, governance/docs | as released | per v5.0.0 |
| **M5 / M5b** feedback signals + `feedback_summary` | observation-only outcome tallies in local event-log; read-only diagnostic | `feedbackSignalsEnabled: true` | local event-log append only; no decision consumes it |
| **M5d** adaptive thresholds (minimal) | pure `proposeThresholdAdjustment()` → clamped, single-step, **recommendation-only** proposal for `minInjectScore` | `adaptiveThresholdsEnabled: false` | **none** — pure, no I/O, never applies, unwired |
| **M4a** readonly agent graph | pure 6-node graph (Observe/Plan/Policy/Verify/Learn/Finalize) → plan/report | n/a | **none** — no fs/child_process import; unwired |
| **M4b** `agent_graph_preview` | read-only `self_learning_control` action exposing M4a | n/a | **none** — writes no event-log/config/patterns/memory |

All post-v5.0.0 additions are **experimental, default-off-or-observation-only,
zero-side-effect, and consumed by no main decision path.**

## 3. Deferred modules

| Module | Status | Record |
|---|---|---|
| **M1** local-embedding semantic retrieval | **deferred-for-current-release (resolved-by-descope, Route C)** — not done / not skipped / not accepted; failing data retained | [BLOCKERS.md](BLOCKERS.md) BLK-1, [M1_BLOCKER_RESOLUTION_PLAN.md](M1_BLOCKER_RESOLUTION_PLAN.md) |
| **M5 adaptive (full auto-tuning)** | not built by design; only the M5d minimal recommendation shell exists | [M5_ADAPTIVE_THRESHOLD_GATE.md](M5_ADAPTIVE_THRESHOLD_GATE.md) |
| **M4 real execution** | out of scope; M4 stays experimental read-only | this doc / [AGENT_GRAPH_READONLY.md](AGENT_GRAPH_READONLY.md) |

**No open blocker.** BLK-1 is closed-as-deferred; nothing else is in `blocked`
state.

## 4. Prohibited-item confirmation (audited)

| Constraint | Verified |
|---|---|
| `tools/search.js` unchanged (no semantic wiring) | ✅ BM25 + RRF path untouched |
| No M1 local embedding revived | ✅ PoC stays on its branch, unmerged |
| No Execute / Repair / Rollback in the readonly graph | ✅ Policy rejects them (forbidden-node-type) |
| M5 adaptive never auto-applies | ✅ `apply` is always `false`; module unwired |
| `adaptive-thresholds` / `agent-graph-readonly` have no fs/child_process | ✅ neither imports fs/child_process; no exec/spawn/fork/writeFile call |
| No new `self_learning_*` tool | ✅ dist still **8 tools / 13 files** |
| No install / tag / release / asset | ✅ none performed |

## 5. dist / build

`npm run build` → **ok**, `dist/ 13 files`, bundle 347.3 kB, zip →
`release/hanako-runtime-learner-dist.zip`.

- dist root: `LICENSE`, `README.md`, `index.js`, `manifest.json`,
  `plugin-process-runner-child.js`, `tools/`.
- `dist/tools/` (8): `activity.js`, `console.js`, `control.js`, `doctor.js`,
  `open-dir.js`, `report.js`, `search.js`, `stats.js`.
- Tool count and filenames unchanged → manifest/dist contract intact.
- `npm audit --omit=dev` → **0 vulnerabilities**.

## 6. Test / gate results (this audit)

| Gate | Result |
|---|---|
| `npm run check` | passed |
| `npm test` | **827 tests · 822 passed · 5 skipped · 0 failed · 0 cancelled** |
| `npm run build` | passed (13 files / 8 tools) |
| `npm run complexity:check` | OK (212 files, max 648 LOC, 0 TODO/FIXME, 4 soft warnings) |
| `npm run benchmark` | passed |
| `npm run perf` | passed (no threshold breaches) |
| `npm run release:check` | passed (Score 100) |

**Doc-consistency fix applied this audit:** README test badge + count text,
`lib/release-readiness.js` `expectedTestCount` defaults (×2), and the
`release-readiness.test.js` fixture default were corrected from the stale `773`
to the true `827`, removing drift accumulated since v5.0.0.

## 7. Freeze status

- **install freeze:** ACTIVE — current main is **not** installed into Hanako; the
  dist zip is **not** used as a real plugin.
- **release freeze:** ACTIVE — no tag, no GitHub Release, no release asset.
- Merging docs/experimental work to main with full gates green is permitted; the
  freezes outlast it.

## 8. What remains before final install

Engineering-side: **nothing blocking.** main is gate-green, dist builds clean,
0 vulnerabilities, no open blocker, all post-v5.0.0 additions are inert/default-off.

Remaining steps are **owner decisions / manual, freeze-gated**:

1. **Maintainer go/no-go** to lift install + release freeze.
2. **Real-Hanako GUI smoke test** (manual, `v0.345.x`): load the dist zip, enable
   the plugin, confirm `self_learning_*` tools load, exercise the read-only
   `feedback_summary` and `agent_graph_preview` actions, verify no failed
   diagnostics. This is the one thing automated gates cannot cover.
3. If a real release is later wanted: decide version bump, then (only after the
   freeze is lifted) tag / Release / asset.

**Audit verdict:** main is a **final-install candidate** from an engineering
standpoint. Recommended next step is the manual real-Hanako smoke test under
maintainer authorization — automated readiness is met; no code blocker found.
