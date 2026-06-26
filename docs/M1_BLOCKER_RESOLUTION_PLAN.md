# M1 Blocker Resolution Plan (BLK-1)

> **Scope: strategy / decision document only. No code.** This plan does **not**
> modify `tools/search.js`, does **not** wire in local embedding, does **not**
> enable `localSemanticEnabled`, installs nothing, and produces no tag / release /
> asset. It exists to decide the **final status of M1** before any further work
> (M5 adaptive / M4 agent) proceeds.
>
> Governance in force: **install freeze + release freeze**. Current `main` is not
> installed into Hanako; the current `dist` zip is not used as a real plugin.

Resolves: **BLK-1 — M1 local-embedding semantic retrieval**
([BLOCKERS.md](BLOCKERS.md), PoC: `poc/v5.1-m1-local-embedding`,
[`docs/POC-v5.1-local-semantic.md`](POC-v5.1-local-semantic.md) on that branch).

---

## 1. Where M1 stands

M1 = wire a local, offline embedding model (transformers.js / onnx-wasm, no
native modules) into `tools/search.js` as a semantic signal fused with the
existing BM25 + RRF hybrid, gated by `localSemanticEnabled` (default off).

The PoC is **technically feasible** (offline, cheap hot path, in budget) but
**misses its retrieval bar**, so M1 is `blocked-by-performance` — not done, not
skipped, not accepted.

### 1.1 Current (failing) data — Chinese benchmark, 40 docs / 30 queries, offline

| system | recall@1 | recall@3 | recall@5 | MRR |
|---|---:|---:|---:|---:|
| BM25-only (baseline) | 60.0% | 76.7% | 83.3% | 0.6943 |
| local q8 + BM25 / RRF | 60.0% | 76.7% | **90.0%** | 0.7101 |
| local fp32 + BM25 / RRF | 60.0% | 76.7% | 90.0% | 0.7081 |

Gain of the candidate (q8 + RRF) over BM25-only:

- **MRR: +2.3%** (0.6943 → 0.7101)
- **recall@3: +0.0%** (76.7% → 76.7%)
- **recall@5: +6.7 pp** (83.3% → 90.0%) — the only positive signal

Feasibility (all PASS, *not* the blocker): offline 0 network · cold load ~197 ms ·
hot 2.5 ms mean / 4.4 ms p95 · asset 24.5 MB (q8). Model:
`Xenova/bge-small-zh-v1.5`.

> Key finding: **fp32 (95 MB) is *worse* than q8 (24 MB)** in the fused score
> (MRR 0.7081 < 0.7101). The ceiling is **model capacity**, not quantization.

### 1.2 Original target threshold (the bar to clear)

- **Primary:** retrieval gain **MRR ≥ +8%** over BM25-only on the Chinese
  benchmark (plan §9.1 acceptance #5).
- **Plus:** a **non-trivial recall@3 improvement** (current +0.0% is the hard
  fail — semantics must move the top of the list, not just the tail).
- Feasibility bars (offline, cold/hot split, p95 ≤ 80 ms, asset ≤ 35 MB, 0 network)
  must remain PASS.

### 1.3 Why it misses (root cause)

The main chain's BM25 is **CJK-bigram + synonym-expansion** — strong on Chinese
because reworded queries still share characters; BM25 alone already reaches
recall@3 76.7% / MRR 0.69. A *small* model adds almost nothing on top, and
fp32-worse-than-q8 proves the limit is the model, not the encoding. Semantics
only helps the deep `recall@5` tail (+6.7 pp).

---

## 2. Three candidate routes to clear BLK-1

Each route below is a **distinct way to close the blocker**. Exactly one will be
chosen by the maintainer. Routes A and B attempt to *pass the bar*; Route C
*formally retires the bar* for this release.

### Route A — Re-test with a larger / better model

Swap `bge-small-zh` for a stronger Chinese retrieval model (`bge-base-zh-v1.5`,
`e5-base`/`-large` class, or a current-gen small-but-strong CJK model), re-run the
**existing** benchmark harness unchanged, and accept only if it clears +8% MRR
**and** a real recall@3 lift within budget.

**Cost**
- Fetch one model via the mirror (`scripts/fetch-embedding-model.js`, HF is
  blocked locally → `HF_MIRROR`); quantize to q8 and measure size.
- Re-run `scripts/benchmark-local-semantic.js` (harness already exists; **no new
  code on the main search path**).
- ~0.5–1 day per model; bounded if time-boxed to 1–2 models.

**Risk**
- **Asset budget collision.** `bge-base` q8 is typically ~35–45 MB and `e5-large`
  far more; clearing the retrieval bar may break the ≤ 35 MB feasibility bar.
  Passing retrieval while failing size is *still a fail* (just a different bar).
- **The ceiling may be the corpus, not the model.** On a 40/30 set where BM25 is
  already at recall@3 76.7%, even a strong model has little headroom — a bigger
  model could still land under +8% MRR.
- Larger model raises cold-load time and memory; must re-verify the cold/hot
  split and p95.
- Once it passes, M1 still requires the **real implementation** (wire into
  `tools/search.js`, gating, tests) — Route A passing is necessary, not
  sufficient, to ship.

**Acceptance criteria (Route A clears BLK-1 only if ALL hold)**
- [ ] q8 (or smaller) variant ≤ **35 MB** asset.
- [ ] MRR gain over BM25-only **≥ +8%** on the Chinese benchmark.
- [ ] recall@3 gain **strictly > 0** and non-trivial (target ≥ +3 pp).
- [ ] Feasibility unchanged: 0 network, p95 ≤ 80 ms, cold load documented.
- [ ] *Then* implement on the main path under `localSemanticEnabled` (separate
      feature branch, full gates) — only that merge actually closes BLK-1.

### Route B — Re-test on a larger / more realistic corpus

Keep the small model (or pair with Route A) but replace the 40/30 fixture with a
**bigger, more representative Chinese corpus** (hundreds of docs, real
word-overlap-free paraphrase cases), on the theory that the current fixture
*understates* semantic value because it is too small and too BM25-friendly.

**Cost**
- **Build/curate the corpus** — the expensive part: hundreds of docs + labeled
  queries with genuine lexical-mismatch cases, ideally drawn from real
  memory/pattern text shapes. Labor-heavy and judgment-heavy.
- Extend `benchmarks/local-semantic-fixtures.zh.json`; re-run the existing
  harness. ~1–3 days dominated by corpus authoring.

**Risk**
- **Moving the goalposts.** A corpus hand-built to favor semantics can manufacture
  a pass that does not reflect the **real** product workload (small per-project
  memory stores where BM25-bigram is genuinely strong). The corpus must be
  defensibly representative or the "pass" is meaningless.
- **May confirm the negative.** A fair larger corpus could equally show BM25 stays
  strong → reconfirms FAIL after spending the most effort of the three routes.
- Same "necessary not sufficient" caveat as Route A: a pass still needs the real
  implementation to actually close BLK-1.

**Acceptance criteria (Route B clears BLK-1 only if ALL hold)**
- [ ] New corpus is **documented as representative** (size, source shape,
      paraphrase methodology) and committed for reproducibility.
- [ ] On that corpus, MRR gain **≥ +8%** and recall@3 gain non-trivial, with the
      chosen model within the ≤ 35 MB budget.
- [ ] Feasibility unchanged (0 network, p95 ≤ 80 ms).
- [ ] *Then* implement on the main path under `localSemanticEnabled` (separate
      branch, full gates).

### Route C — Formally descope / defer M1 from this release

Accept that, on the real workload, BM25-bigram + synonym + RRF is the final
retrieval stack **for this release**. Record M1 local-embedding as **deferred**
(not failed, not deleted): the PoC and benchmark harness stay on
`poc/v5.1-m1-local-embedding` as reproducible assets for a future re-test, and the
**external-endpoint embeddings** path (`lib/embeddings.js`, opt-in) remains the
available semantic option for anyone who wants it.

**Cost**
- **Near zero.** Update [BLOCKERS.md](BLOCKERS.md): change BLK-1 from
  `blocked-by-performance` (open) to **`deferred` (closed-out-of-scope)** with an
  explicit maintainer sign-off line and the data snapshot. No code, no model, no
  corpus.

**Risk**
- **Lose the recall@5 tail.** Forgo the only positive signal (+6.7 pp at
  recall@5). In practice low impact: top-1/top-3/MRR are unchanged by the PoC, and
  the product injects a small top-k, so the deep tail rarely matters.
- **Perception** of "giving up" on a planned feature. Mitigated by keeping the PoC
  and the explicit, data-backed reason; deferral is reversible the moment a model
  or corpus clears the bar.
- Must be a **deliberate maintainer decision**, not a silent skip — that is the
  whole point of the all-features-complete policy.

**Acceptance criteria (Route C clears BLK-1)**
- [ ] Maintainer explicitly accepts BM25-only (with external-endpoint embeddings
      as the opt-in semantic fallback) as the **final** retrieval stack for this
      release.
- [ ] BLK-1 status updated to **deferred**, with the failing-data snapshot and the
      future-restart conditions preserved in BLOCKERS.md.
- [ ] PoC branch + benchmark harness retained (not deleted).
- [ ] No `localSemanticEnabled`, no `tools/search.js` change ships in this release.

---

## 3. Recommendation

**Recommended: Route C (formally defer M1 from this release), with an optional,
strictly time-boxed Route A spike as a pre-condition if the maintainer wants to
exhaust the technical path first.**

Reasoning:

1. **The evidence points at a structural ceiling, not a tuning gap.** fp32 being
   *worse* than q8 means more model precision does not help; the limiting factor
   is small-model capacity against an already-strong CJK-bigram BM25. That is
   exactly the situation where chasing the bar has low expected return.
2. **The real workload favors BM25.** Per-project memory stores are small and
   share characters across paraphrases; the +6.7 pp lives only in the recall@5
   tail, which a small injected top-k barely uses. The feature would add tens of
   MB of asset weight for a gain the product can hardly spend.
3. **The release policy makes an open blocker maximally expensive.** Under
   "ship only when *all* features are complete," BLK-1 freezes the entire release
   indefinitely. Route C converts an indefinite freeze into a clean, auditable
   decision and unblocks everything downstream (M5 adaptive gate review, M4
   experimental graph, final release prep) without shipping weight that does not
   earn its place.
4. **Nothing is lost permanently.** The PoC, harness, and external-endpoint path
   all survive; BLK-1's restart conditions stay on record. If a future model or a
   genuinely representative larger corpus clears +8%, M1 can be revived as a
   normal feature.

**If the maintainer prefers to try once more before deferring**, run a **bounded
Route A spike**: exactly one model (`bge-base-zh-v1.5` q8), measured against the
existing harness, hard pass/fail on the §2-Route-A criteria, one working session.
If it passes → switch to implementing M1 properly. If it does not → take Route C
with the extra data point in hand. **Route B is not recommended first** — it is
the highest-effort route and most prone to goalpost-moving; reserve it only if a
Route A model shows promise but the small fixture is demonstrably the limiter.

**Not recommended:** leaving BLK-1 open and idle (indefinite freeze), or silently
skipping M1 (violates the all-features-complete policy — the decision must be the
explicit deferral of Route C).

---

## 4. What this plan does NOT do

- Does not modify `tools/search.js` or any main search path.
- Does not wire in local embedding or add `localSemanticEnabled`.
- Does not install the plugin, build a release, tag, or upload an asset.
- Does not itself change BLK-1's status — it presents routes; the maintainer
  picks one, and *that* follow-up updates BLOCKERS.md.

Gates run for this docs-only change: `npm run check`, `npm test`,
`npm run complexity:check`.
