# Install Smoke Test Result — v5.1.0

> **Record only.** This documents the result of a manual Hanako GUI install/load
> smoke test for the `5.1.0` internal install candidate. No code changed, no new
> feature, nothing installed/tagged/released as part of writing this record.

- **Date:** 2026-06-26
- **Version under test:** `5.1.0` (internal install smoke candidate, **not** a
  GitHub Release)
- **Artifact:** `release/hanako-runtime-learner-dist.zip` (esbuild dist bundle,
  13 files / 8 tools, runtime zero-dependency)
- **Host:** Hanako Agent (real GUI), `v0.345.x` baseline (`minAppVersion 0.345.0`)
- **Result:** ✅ **PASSED**

## What was verified

| Check | Result |
|---|---|
| Plugin loads / `onload` succeeds in the Hanako GUI | ✅ |
| `self_learning_*` tools register and are callable | ✅ |
| Read-only `feedback_summary` action works | ✅ |
| Read-only `agent_graph_preview` action works (M4b diagnostic entry) | ✅ |
| No failed-state diagnostics in the plugin panel | ✅ |
| Default-off experimental features stay off (no adaptive auto-tuning, no agent execution) | ✅ |

The smoke test exercised the host-side surface that automated gates cannot cover
(real GUI load, tool registration, action invocation). It is a load/diagnostic
smoke test, not a functional regression of every code path — those are covered by
the 827-test automated suite.

## Known boundary: dev-slot shadowing of an older v5.0.0

When the plugin is loaded in a **development slot alongside an already-installed
community v5.0.0**, the host may resolve the tool/action schema from the **older
v5.0.0** copy. In that shadowed state the **new actions added after v5.0.0 can be
masked** — notably the M4b read-only **`agent_graph_preview`** action (and any
other post-v5.0.0 action surface), because the old v5.0.0 schema does not declare
them.

**Implication / guidance:**

- For a proper install, **replace the old v5.0.0** with this `5.1.0` build —
  do **not** run the two side by side.
- After replacing, confirm `agent_graph_preview` is present in the
  `self_learning_control` action list to verify the new schema is the one in
  effect (a quick way to detect lingering shadowing).
- This is an install-coexistence artifact of dev-slot/older-copy precedence, **not**
  a defect in the 5.1.0 build itself; the 5.1.0 schema exposes the action
  correctly when it is the active copy.

## Status after smoke test

- Engineering readiness: met (see [FINAL_INSTALL_READINESS.md](FINAL_INSTALL_READINESS.md)).
- Manual real-Hanako GUI smoke test: **passed** (this document).
- release freeze: **still active** — no tag, no GitHub Release, no asset upload.
  This record does not change the freeze; lifting it remains a separate
  maintainer decision.
