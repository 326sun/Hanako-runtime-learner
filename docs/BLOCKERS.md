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

---

## BLK-1 — M1 local-embedding semantic retrieval

| Field | Value |
|---|---|
| **Status** | **blocked-by-performance** (not done / not skipped / not accepted) |
| **Feature** | Local-embedding semantic retrieval wired into the main search path |
| **Plan ref** | v5.0 modernization plan §9.1 "M1 — 本地 embedding + wasm 向量索引", acceptance criterion #5 |
| **PoC branch** | `poc/v5.1-m1-local-embedding` (kept, not merged) |
| **PoC doc** | `docs/POC-v5.1-local-semantic.md` (on the PoC branch) |
| **Release impact** | **YES — blocks final release** under the all-features-complete policy |

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

### Exit criteria (to clear BLK-1)

One of:

- [ ] A model/config meets **≥ +8% MRR** (and improved recall@3) offline within
      the asset budget, wired into `tools/search.js`, default-safe gating; **or**
- [ ] The maintainer formally re-scopes M1 out of the release (recorded here),
      explicitly accepting BM25-only (or the external-endpoint fallback) as final.

Until then BLK-1 is **open** and release is **frozen**.

---

## Notes on adjacent items (NOT blockers)

- **M5c adaptive threshold** — a **design-only gate**
  ([M5_ADAPTIVE_THRESHOLD_GATE.md](M5_ADAPTIVE_THRESHOLD_GATE.md)), merged as docs.
  It is **not** counted as an M5 *feature* completion: no `adaptiveThresholdsEnabled`,
  no threshold change, feedback stays observation-only. It is neither blocked nor
  a feature deliverable — it is a paper gate that *precedes* any decision to build
  the adaptive layer. The adaptive-threshold *feature* itself remains unbuilt by
  design and is out of the current release scope.
