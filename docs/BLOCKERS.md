# Release Blockers

> **Release policy (updated 2026-06-26):** the project ships **only after all
> planned features are complete**. The earlier "release v5.0 core first, fill in
> the rest later" strategy is **abandoned**. Therefore *any* feature in
> `blocked` state below is a hard release blocker: **no tag, no GitHub Release,
> no release asset** may be produced while a blocker is open. This is in addition
> to, and outlasts, the existing release freeze.

This file is the authoritative registry of features that are **blocked**, i.e.
not done, not skipped, not accepted — work that must still land (or be formally
re-scoped by the maintainer) before final release.

Status vocabulary used here:

- **blocked-by-performance** — feature is technically implementable and a PoC
  exists, but it does not meet its acceptance performance bar. It is **not**
  `done`, **not** `skipped`, **not** `accepted`. It blocks release.
- **deferred-for-current-release (resolved-by-descope)** — the maintainer has
  made an explicit, recorded decision to take the feature **out of the current
  release scope**. This is **not** a performance pass and **not** a feature
  completion; it is a formal deferral. The feature no longer blocks release. The
  failing evidence and restart conditions are preserved so it can be reopened in
  a future release.

---

## BLK-1 — M1 local-embedding semantic retrieval

| Field | Value |
|---|---|
| **Status** | **deferred-for-current-release (resolved-by-descope)** — *was* blocked-by-performance; descoped by maintainer 2026-06-26 (Route C). **Not** a performance pass, **not** a feature completion. |
| **Feature** | Local-embedding semantic retrieval wired into the main search path |
| **Plan ref** | v5.0 modernization plan §9.1 "M1 — 本地 embedding + wasm 向量索引", acceptance criterion #5; decision in [M1_BLOCKER_RESOLUTION_PLAN.md](M1_BLOCKER_RESOLUTION_PLAN.md) §5 |
| **PoC branch** | `poc/v5.1-m1-local-embedding` (kept, **not merged**) |
| **PoC doc** | `docs/POC-v5.1-local-semantic.md` (on the PoC branch) |
| **Release impact** | **No longer blocks release** — formally deferred out of the current final install scope. The failing benchmark evidence below is retained. |

### Feature name (precise)

Wire a **local, offline embedding model** (transformers.js / onnx-wasm, no native
modules) into `tools/search.js` as a semantic retrieval signal fused with the
existing BM25 + RRF hybrid — i.e. flip the runtime from BM25-only to
BM25+embedding hybrid for memory/pattern retrieval. Gated by a
`localSemanticEnabled` config (default `false`/`auto`, never implicit-`true`).

This is the feature that was **skipped during the v5.x pass for performance
reasons** and is now reclassified from "skipped" to **blocked**.

### Current performance data (PoC, `Xenova/bge-small-zh-v1.5` q8, 24.5 MB)

Feasibility (all PASS — these are not the blocker):

| Metric | Measured | Bar | Verdict |
|---|---|---|---|
| Offline / network calls | 0 | 0 | PASS |
| Cold model load | ~197 ms | one-time, separate from hot path | PASS |
| Hot per-query (mean / p95) | 2.5 ms / 4.4 ms | sub-10 ms | PASS |
| Asset size | 24.5 MB (q8) | acceptable / documented | PASS |

Retrieval gain (the blocker — Chinese benchmark, 40 docs / 30 queries,
q8 + BM25 / RRF **vs** BM25-only):

| Metric | Measured gain | Notes |
|---|---|---|
| MRR | **+2.3%** | well under bar |
| recall@3 | **+0.0%** | no improvement |
| recall@5 | **+6.7 pp** | the *only* positive signal |

> Counter-intuitive finding: **fp32 performed *worse* than q8**, so the ceiling is
> the *small model's quality*, not quantization loss.

### Target performance threshold

- **Primary bar:** retrieval gain **≥ +8% MRR** over BM25-only on the Chinese
  benchmark (plan §9.1 #5), with a non-trivial recall@3 improvement.
- Feasibility bars (offline, cold/hot split, asset size) must remain PASS.

### Why it does not meet the bar

The main retrieval chain's BM25 is already **CJK-bigram + synonym-expansion**,
which is strong on Chinese: rewording a query still shares characters, so BM25
alone recovers most relevant docs. A *small* embedding model adds little on top,
and fp32-vs-q8 shows the limit is **model capacity**, not the encoding. The only
place semantics helps is the deeper `recall@5` tail.

### Possible optimization paths

1. **Bigger / better model** — `bge-base` / `e5`-class, relaxing the asset budget
   (e.g. ≤ 35 MB) to buy real headroom over the small-model ceiling.
2. **More realistic / larger corpus** — re-run on a bigger, more representative
   Chinese benchmark; the current 40/30 set may understate semantic value.
3. **Targeted use** — apply semantics only as a **recall@5 tail re-rank / fallback**
   rather than a primary fused signal, since that is where the +6.7 pp lives.

### Degraded / fallback implementation available?

**Yes (two options, neither merged):**

- **External-endpoint embeddings** — `lib/embeddings.js` already supports an
  external embedding endpoint; semantic retrieval is reachable today *without*
  shipping a local model (at the cost of a network dependency, opt-in).
- **recall@5-only re-rank** — a narrow degraded mode using the local model purely
  for tail re-ranking, accepting it adds no MRR/recall@3 gain.

Both are **fallbacks, not the accepted feature**: shipping a fallback does **not**
clear BLK-1. The blocker clears only when the primary bar is met, or the
maintainer formally re-scopes the feature out of the release.

### Resolution (2026-06-26): descoped via Route C

The maintainer chose **Route C** from
[M1_BLOCKER_RESOLUTION_PLAN.md](M1_BLOCKER_RESOLUTION_PLAN.md): M1 is **formally
deferred out of the current release**, accepting BM25-bigram + synonym + RRF as
the final retrieval stack (external-endpoint embeddings in `lib/embeddings.js`
remains the opt-in semantic path). Routes A/B (larger-model / larger-corpus
re-tests) were **not** executed.

This resolution is a **deferral, not a pass and not a completion**:

- M1 did **not** clear its bar — the failing data above (MRR +2.3% vs +8%,
  recall@3 +0.0%) stands and is deliberately retained as evidence.
- `tools/search.js` is **not** modified; local embedding is **not** wired in;
  `localSemanticEnabled` is **not** added/enabled.
- The PoC branch `poc/v5.1-m1-local-embedding` is **not** merged; the PoC +
  benchmark harness are **retained** for a future re-test.

**Reopen conditions (future release only).** BLK-1 may be reopened if any holds:

- [ ] A model/config meets **≥ +8% MRR** (and a non-trivial recall@3 lift) offline
      within the ≤ 35 MB asset budget; **or**
- [ ] A documented, representative larger Chinese corpus shows the same; **or**
- [ ] The asset budget is formally relaxed to admit a bge-base/e5-class model that
      clears the bar.

Until such a reopen, **BLK-1 is closed as deferred** and M1 is **out of the
current final install scope**. (The install/release freeze itself is a separate,
still-active governance state — see the policy header above.)

---

## Notes on adjacent items (NOT blockers)

- **M5c adaptive threshold** — a **design-only gate**
  ([M5_ADAPTIVE_THRESHOLD_GATE.md](M5_ADAPTIVE_THRESHOLD_GATE.md)), merged as docs.
  It is **not** counted as an M5 *feature* completion: no `adaptiveThresholdsEnabled`,
  no threshold change, feedback stays observation-only. It is neither blocked nor
  a feature deliverable — it is a paper gate that *precedes* any decision to build
  the adaptive layer. The adaptive-threshold *feature* itself remains unbuilt by
  design and is out of the current release scope.
