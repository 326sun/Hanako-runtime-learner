# Architecture

Runtime Self-Learning v4.3.0 — 81 lib modules, 9 tools, 1 entry point.

---

## Four-layer pipeline

```
Layer 1: Observe
  EventBus -> observer.js -> SessionTurn -> flushTurn

Layer 2: Learn
  flushTurn -> pattern-detector.js -> workflow / preference / error / usage

Layer 3: Act
  pipeline.js -> autoApprove / pruneMemory / persistPatterns / refreshSkill / model-advisor
  action-executor.js -> action-registry / transaction / scope-gate / command-allowlist

Layer 4: Govern
  proposals.js -> review-queue / validation-gate / content-hash binding
  agent-controller.js -> repair/rollback branches / human-interrupt
  benchmark-corpus.js -> release-readiness.js -> audit-dashboard.js
```

---

## Module map

### Core runtime

| File | Responsibility |
|------|---------------|
| `observer.js` | EventBus subscription, SessionTurn lifecycle, flushTurn orchestration |
| `session-turn.js` | Turn tool/error/user-text tracking |
| `pattern-detector.js` | Pattern ingest/reinforce/decay/prune; category index; relation linking |
| `pattern-detector-ingest.js` | Workflow/preference/error/usage pattern creation |
| `pipeline.js` | Post-flush pipeline; action policy evaluation; auto-action orchestration |

### Retrieval

| File | Responsibility |
|------|---------------|
| `memory-index.js` | CJK-aware BM25 inverted index with bigram tokenization |
| `memory-gate.js` | Admission control: reject rejected/ephemeral/cross-project/expired |
| `scope.js` | Project/task-type scope inference and matching |
| `embeddings.js` | Optional semantic search with RRF fusion (off by default; includes former rank-fusion.js) |
| `helpers.js` | Tool categories, task/error classification, correction extraction, usage dedup, disk sync |

### Execution & security

| File | Responsibility |
|------|---------------|
| `action-executor.js` | Main action dispatch: patch, test, lint, diagnose, retry, locate, compact, registry-routed |
| `action-registry.js` | Action definition registration, validation, execution, verification, rollback |
| `action-transaction.js` | File-level transactions: snapshot, commit, rollback |
| `command-allowlist.js` | Command allowlist/denylist; spawn(shell:false); project script trust with audit logging |
| `filesystem-boundary.js` | Realpath-aware workspace boundary for reads and writes |
| `scope-gate.js` | Pre-execution diff preview and scope boundary evaluation |
| `project-script-trust.js` | Package.json scripts hash baseline and change detection |

### Governance

| File | Responsibility |
|------|---------------|
| `proposals.js` | Proposal CRUD, apply/reject, diff preview, content hash binding |
| `review-queue.js` | Review queue, status tracking, review-proposal binding |
| `agent-controller.js` | Agent task state machine with repair/rollback branches |
| `benchmark-corpus.js` | 17-scenario built-in corpus and runner |
| `release-readiness.js` | LTS release contract verification (9 checks) |
| `audit-dashboard.js` | Consolidated dashboard with recommendations |
| `audit-bundle.js` | Portable audit bundle for governance review |
| `credentials.js` | AES-256-GCM encryption for sensitive config values |

### Skill promotion

| File | Responsibility |
|------|---------------|
| `skill-promotion-loop.js` | End-to-end: reflexion->cluster->candidate->evidence->staged->active |
| `skill-promotion-store.js` | Candidate and active skill registry persistence |
| `skill-promotion-decision.js` | Merge/absorb/transition/upsert decisions |
| `skill-renderer.js` | SKILL.md generation from active patterns and registry |
| `skill-lifecycle.js` | SKILL.md snapshot, backup, change detection |

### Cross-project transfer

| File | Responsibility |
|------|---------------|
| `cross-project-scope.js` | Transfer candidate validation and safety rules |
| `transfer-registry.js` | Candidate persistence, validation recording, expiry |
| `transfer-validation-runner.js` | Target-project validation command execution |

### Infrastructure

| File | Responsibility |
|------|---------------|
| `common.js` | Public re-export facade; `nowIso()` |
| `json-io.js` | Atomic JSON read/write with tmp+rename |
| `jsonl-utils.js` | JSONL tail-line reading |
| `atomic-file.js` | Atomic file write (tmp + rename) |
| `scoring.js` | Pattern decay scoring, knowledge tier, decoration |
| `activity-log.js` | Batched JSONL append and log pruning |
| `event-log.js` | Audit event append, replay, and verification |
| `config-defaults.js` | Default configuration values |
| `hana-runtime-compat.js` | Hanako plugin system compatibility layer |

---

## Key design decisions

1. **Zero runtime dependencies** — pure JS BM25 inverted index, no SQLite or external tokenizers.
2. **Ebbinghaus forgetting curve** — `score * e^(-lambda * t)`, high-frequency patterns persist, low-frequency decay naturally.
3. **Scope-aware retrieval** — cross-project memory is hard-rejected, cross-task is soft-penalized.
4. **Atomic I/O** — all `writeJson` calls go through tmp+rename for crash safety.
5. **Fail-closed security** — scope gate, policy gate, and command allowlist all default to rejection.
6. **No auto-escalation** — R4 actions, external side effects, and credential access are never auto-executed.
