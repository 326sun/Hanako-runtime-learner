# Local Hanako Smoke Test: v4.3.0 LTS

**Test date:** 2026-06-11  
**Plugin version:** 4.3.0-lts  
**Node version:** v24.15.0  
**OS:** Windows 10  
**Hanako profile:** xiongda

## Startup

**Result:** ✅ Dev plugin installed, loaded, and activated.  
**Evidence:** `plugin_dev_enable` returned `status: loaded, activationState: activated`.

Installation via `npm run install-plugin` passed all 65 source file syntax checks and copied plugin to both `~/.hanako/plugins/hanako-runtime-learner` and `~/.hanako/plugins-dev/hanako-runtime-learner`.

Data directory preserved: `C:\Users\24089\.hanako\self-learning`.

## Tool calls

| Tool | Result | Notes |
|---|---|---|
| `self_learning_stats` | ✅ pass | 5237 turns, 30 patterns, 15 injectable, balanced governance profile |
| `self_learning_control status` | ✅ pass | 30 patterns, 40 applied proposals, 0 pending proposals, 0 pending reviews |
| `self_learning_doctor` | ✅ pass | Good (97/100). Only info-level: 7 high-score patterns lack evidence |
| `self_learning_report` | ✅ pass | 1327 tasks in last day, 150 errors, 15 injectable hints, 8 rejected patterns |
| `self_learning_activity` | ✅ pass | 10 activities in last day: session_start × 4, session_end × 2, auto_approved × 1, usage_pattern_discovered × 3 |
| `self_learning_search` | ✅ pass | BM25 + gate + relation retrieval. Query "self-evolve release check" returned 5 scope-gated results with official memory bridge supplement |
| `self_learning_open_dir` | skipped | UI-only action, requires user trigger in Hanako UI |
| `self_learning_control release_readiness` | ✅ pass | Score 100, 15/15 checks including 6 new narrative consistency checks (README badges, clone branch, manifest version, API freeze version) |

## Learning loop

**Result:** ✅ Active injection is functioning. 15 injectable patterns with decayed scores from 2.8 to 9103.77. Patterns include:
- Large-context usage warnings for 5 model providers
- Tool error patterns (bash failures, unknown terminations)
- Workflow discovery (code → file exploration patterns)
- User preference corrections

Pending patterns: 7 (status=pending, awaiting review). Rejected: 8. Evidence exists in `experience_log.jsonl` and `error_log.jsonl`.

**Scope gate:** Search returned project-scoped results only. Official memory bridge returned cross-agent context as supplementary read-only data.

## Safety loop

**Result:** ✅ Safety boundaries verified by existing architecture (not breached in smoke test):
- R4 actions: never auto-executed (API freeze confirms)
- External side effects: never auto-executed
- R2 writes: require transaction + verification + rollback
- `governanceProfile` set to `balanced` (auto-inject enabled, conservative limits active)
- `modelAdvisorEnabled`: false (no external data sent)
- `semanticSearchEnabled`: false (no embeddings API calls)
- `requireReviewForAutoApply`: false (balanced mode, but no pending proposals exist)

## Release readiness (from Hanako)

**Result:** ✅ Score 100. All 15 checks passed:

```text
package.version_lts_format        passed
package_lock.version_matches      passed
docs.required_lts_docs            passed
docs.acceptance_current_version   passed
docs.changelog_current_section    passed
docs.design_matrix_current_version passed
docs.api_freeze_mentions_lts      passed
benchmarks.corpus_valid           passed
benchmarks.baseline_and_thresholds passed
readme.version_badge              passed
readme.test_badge                 passed
readme.clone_branch               passed
manifest.version                  passed
docs.api_freeze_version           passed
readme.test_count_text            passed
```

## Fixed regression: report.js `learnerDir` reference

During smoke test, `self_learning_report` failed with `learnerDir is not defined`. Root cause: in `tools/report.js` line 112, the template literal referenced bare `learnerDir` instead of `p.learnerDir`. Fixed and verified in dev reload.

## Final decision

**Ready.** v4.3.0-lts passes all Node gate checks and all Hanako tool smoke tests. No blocking issues. Proceed to GitHub tag and release.
