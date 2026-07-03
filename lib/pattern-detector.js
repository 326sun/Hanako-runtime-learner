/**
 * PatternDetector — core pattern detection engine for Runtime Self-Learning.
 * Extracted from index.js to enable independent testing and modular reasoning.
 *
 * Detects three pattern types:
 *   - workflow: repeated tool-category sequences across turns
 *   - preference: user corrections with durability assessment
 *   - error: recurring tool/request failures
 *   - usage: large-context or failed-request patterns
 *
 * Uses Ebbinghaus forgetting curve for memory pruning (see common.js).
 */

import { preferencePatternId } from "./helpers.js";
import {
  knowledgeTier,
  decoratePatterns,
  DEFAULT_CONFIG,
  scoreSignals,
} from "./common.js";
import { ingestError as ingestErrorPattern, ingestPreference, ingestUsage as ingestUsagePatterns, ingestWorkflow } from "./pattern-detector-ingest.js";
import { MAX_PATTERN_COUNT, uniqueSortedToolCategories } from "./pattern-detector-utils.js";

function countCategoryOverlap(activeCats, storedCats) {
  if (!Array.isArray(storedCats) || storedCats.length === 0) return 0;
  let overlap = 0;
  for (const cat of activeCats) {
    if (storedCats.includes(cat)) overlap += 1;
  }
  return overlap;
}

function taskTypeIncludes(rawTaskType, taskType) {
  if (!taskType) return false;
  for (const item of String(rawTaskType || "general").split(",")) {
    if (item.trim() === taskType) return true;
  }
  return false;
}

function hasMultipleDistinctValues(values) {
  if (!Array.isArray(values) || values.length < 2) return false;
  const first = values[0];
  for (let i = 1; i < values.length; i++) {
    if (values[i] !== first) return true;
  }
  return false;
}

function firstMatching(items, predicate, limit = 8) {
  const out = [];
  for (const item of items) {
    if (!predicate(item)) continue;
    out.push(item);
    if (out.length >= limit) break;
  }
  return out;
}

export class PatternDetector {
  constructor(config) {
    this.config = config;
    this.patterns = new Map();
    this.seqCache = new Map();
    this.seqInsertOrder = [];
    this.turnCount = 0;
    this.catIndex = new Map();
    this.maxPatternCount = MAX_PATTERN_COUNT;
    this._cacheDirty = true;
    this._cachedAll = null;
    this._storeDirty = false;
  }

  setConfig(config) {
    this.config = config;
    this._cacheDirty = true;
  }

  // Invalidate the decorated-pattern cache after a *side-channel* mutation —
  // i.e. any code outside the ingest*/restore/pruneMemory family that edits a
  // stored pattern's status/score/fix/etc. directly (auto-approve, score boosts,
  // advisor merge, disk-status sync, pin_memory). Without this, all() keeps
  // serving the pre-mutation snapshot until the next ingest flips the dirty bit.
  invalidate() {
    this._cacheDirty = true;
    this._storeDirty = true;
  }

  isDirty() {
    return this._storeDirty;
  }

  markClean() {
    this._storeDirty = false;
  }

  // ── Category index helpers ──

  _indexPattern(id, categories) {
    if (!categories || !categories.length) return;
    for (const cat of categories) {
      if (!this.catIndex.has(cat)) this.catIndex.set(cat, new Set());
      this.catIndex.get(cat).add(id);
    }
  }

  _unindexPattern(id, categories = null) {
    if (Array.isArray(categories) && categories.length) {
      for (const cat of categories) {
        const ids = this.catIndex.get(cat);
        if (!ids) continue;
        ids.delete(id);
        if (ids.size === 0) this.catIndex.delete(cat);
      }
      return;
    }
    for (const [cat, ids] of this.catIndex) {
      ids.delete(id);
      if (ids.size === 0) this.catIndex.delete(cat);
    }
  }

  // Fully evict a pattern: drop it from the store, the category index, AND — for
  // workflows — the seqCache/seqInsertOrder counters keyed on its category
  // signature. Without clearing the counter, a workflow pruned for decay would
  // resurrect at its old (high) count the next time the sequence recurs, since
  // ingest resumes from `seqCache.get(catKey) + 1` — silently undoing forgetting.
  // Also cleans up orphan relation edges pointing to this pattern.
  _forgetPattern(id) {
    this._cacheDirty = true;
    this._storeDirty = true;
    const pattern = this.patterns.get(id);
    this._unindexPattern(id, pattern?.context?.categories);
    this.patterns.delete(id);
    // Clean orphan relations: remove edges that point to the pruned pattern.
    for (const [, p] of this.patterns) {
      const rels = p.context?.relations;
      if (!Array.isArray(rels) || !rels.length) continue;
      const before = rels.length;
      p.context.relations = rels.filter((r) => r.targetId !== id);
      if (p.context.relations.length < before) this._cacheDirty = true;
    }
    if (typeof id === "string" && id.startsWith("workflow:")) {
      const catKey = id.slice("workflow:".length);
      this.seqCache.delete(catKey);
      const idx = this.seqInsertOrder.indexOf(catKey);
      if (idx !== -1) this.seqInsertOrder.splice(idx, 1);
    }
  }

  // Batched eviction: forget many patterns with a SINGLE orphan-relation pass.
  // Final store/index/seqCache state is identical to calling _forgetPattern per
  // id, but the relation cleanup is O(n + k) instead of O(k·n) — the per-id scan
  // over all patterns is the dominant cost when pruning many patterns at once.
  _forgetPatterns(ids) {
    const idSet = ids instanceof Set ? ids : new Set(ids || []);
    if (idSet.size === 0) return;
    this._cacheDirty = true;
    this._storeDirty = true;
    const workflowKeys = new Set();
    for (const id of idSet) {
      const pattern = this.patterns.get(id);
      this._unindexPattern(id, pattern?.context?.categories);
      this.patterns.delete(id);
      if (typeof id === "string" && id.startsWith("workflow:")) {
        const catKey = id.slice("workflow:".length);
        this.seqCache.delete(catKey);
        workflowKeys.add(catKey);
      }
    }
    if (workflowKeys.size) {
      this.seqInsertOrder = this.seqInsertOrder.filter((key) => !workflowKeys.has(key));
    }
    // One pass over survivors: drop edges pointing to any forgotten id.
    for (const [, p] of this.patterns) {
      const rels = p.context?.relations;
      if (!Array.isArray(rels) || !rels.length) continue;
      const filtered = rels.filter((r) => !idSet.has(r.targetId));
      if (filtered.length < rels.length) p.context.relations = filtered;
    }
  }

  // ── Restore ──

  restore(saved) {
    this._cacheDirty = true;
    this._cachedAll = null;
    this._storeDirty = false;
    this.patterns.clear();
    this.seqCache.clear();
    this.seqInsertOrder = [];
    this.catIndex.clear();
    for (const pattern of saved || []) {
      if (!pattern?.id) continue;
      this.patterns.set(pattern.id, pattern);
      // Rebuild category index
      if (pattern.context?.categories) {
        this._indexPattern(pattern.id, pattern.context.categories);
      }
      if (pattern.type === "workflow" && Array.isArray(pattern.tools)) {
        // Derive category key from stored tools for seqCache restoration
        const uniqueCats = uniqueSortedToolCategories(pattern.tools);
        if (uniqueCats.length >= 2) {
          const key = uniqueCats.join("→");
          this.seqCache.set(key, pattern.count || 1);
          if (!this.seqInsertOrder.includes(key)) this.seqInsertOrder.push(key);
        }
      }
    }
    while (this.seqInsertOrder.length > MAX_PATTERN_COUNT) {
      this.seqCache.delete(this.seqInsertOrder.shift());
    }
  }

  /**
   * Ingest a turn experience. Detects workflows (≥3 occurrences of a
   * cross-category tool sequence) and preferences (user corrections).
   * Mutates the internal pattern store and category index.
   *
   * @param {object} exp — { date, taskType, toolsUsed, correction, ... }
   * @returns {Array<{id, type, desc, count}>} newly created/upgraded patterns
   */
  ingest(exp) {
    this._cacheDirty = true;
    this._storeDirty = true;
    this.turnCount += 1;
    const newPatterns = [];
    this._ingestWorkflow(exp, newPatterns);
    this._ingestPreference(exp, newPatterns);
    if (newPatterns.length > 0 || exp.correction) this._linkRelations(exp);
    return newPatterns;
  }

  _ingestWorkflow(exp, newPatterns) {
    return ingestWorkflow(this, exp, newPatterns);
  }

  _ingestPreference(exp, newPatterns) {
    return ingestPreference(this, exp, newPatterns);
  }

  _linkRelations(exp) {
    const activeCats = uniqueSortedToolCategories(exp.toolsUsed);
    const activeTask = exp.taskType || "general";
    if (activeCats.length < 2 && activeTask === "general") return;

    // Find the IDs of patterns that were just created or updated in this ingest call
    const targets = [];
    if (activeCats.length >= 2) {
      const catKey = activeCats.join("→");
      targets.push(`workflow:${catKey}`);
    }
    if (exp.correction) {
      targets.push(preferencePatternId(exp.correction));
    }

    // Use category index to avoid O(n²): only check patterns that share ≥1 category
    const candidateIds = new Set();
    for (const cat of activeCats) {
      for (const id of (this.catIndex.get(cat) || [])) {
        candidateIds.add(id);
      }
    }

    for (const targetId of targets) {
      const target = this.patterns.get(targetId);
      if (!target) continue;
      target.context = target.context || {};
      const rels = target.context.relations || [];

      for (const id of candidateIds) {
        if (id === targetId) continue;
        const stored = this.patterns.get(id);
        if (!stored) continue;
        if (stored.type === "capability" || stored.type === "host_capability") continue;

        const catOverlap = countCategoryOverlap(activeCats, stored.context?.categories);
        const taskMatch = activeTask !== "general" && taskTypeIncludes(stored.context?.taskType, activeTask);

        let type = null, weight = 0;
        if (catOverlap >= 3) { type = "strong-related"; weight = catOverlap * 1.0; }
        else if (catOverlap >= 2) { type = "shared-tools"; weight = catOverlap * 0.5; }
        else if (taskMatch) { type = "same-task"; weight = 0.3; }
        else if (catOverlap >= 1 && exp.correction) { type = "co-occurred"; weight = 0.2; }
        if (!type) continue;

        const exists = rels.find(r => r.targetId === id);
        if (exists) { exists.weight = Math.max(exists.weight, weight); }
        else { rels.push({ targetId: id, type, weight }); }
      }

      if (rels.length > 8) rels.splice(0, rels.length - 8);
      target.context.relations = rels;
    }
  }

  /**
   * Ingest an error event. Creates or reinforces an error pattern with a
   * structured repair plan. Non-retryable errors (permission_denied,
   * command_not_found, etc.) carry explicit "do NOT retry" guidance.
   *
   * @param {object} err — { date, errorType, errorDesc, severity, tool }
   * @returns {{ pattern: object, isNew: boolean }}
   */
  ingestError(err) {
    this._cacheDirty = true;
    this._storeDirty = true;
    return ingestErrorPattern(this, err);
  }

  ingestUsage(entry = {}) {
    this._cacheDirty = true;
    this._storeDirty = true;
    return ingestUsagePatterns(this, entry);
  }

  /**
   * Prune the pattern store in a single pass. Durable patterns are capped by
   * count (latest-wins). Non-durable/non-manual-approved patterns are first
   * checked against score-floor decay, then the remaining pool is capped at
   * MAX_PATTERN_COUNT * 2 by ascending memoryStrength.
   *
   * Two decay rules serve different purposes in this method:
   *   - Stage 2 (score-floor prune) uses decayedScore: standard half-life
   *     decay (score * 0.5^(days/halfLife)). Drops any pattern whose
   *     score has decayed below 1 — "is this still relevant?"
   *   - Stage 3 (strength-based cap) uses memoryStrength: count-weighted
   *     decay (half-life scaled by sqrt(count)). Among equally old patterns,
   *     those with more repetitions survive longer — "which of these should
   *     we keep when we're out of space?"
   *
   * The two-stage design intentionally applies different decay geometries:
   * the score floor is a fixed bar (binary keep/drop), while the cap is a
   * relative ranking among survivors.
   */
  pruneMemory() {
    const durableMax = Math.max(1, Number(this.config?.durableMemoryMaxCount || DEFAULT_CONFIG.durableMemoryMaxCount));
    const now = Date.now();

    // Single-pass classification: durable + manual-approved are keep-forever;
    // everything else is evaluable for decay-based pruning.
    const durableEntries = [];
    const evaluable = [];
    for (const [id, p] of this.patterns.entries()) {
      const tier = knowledgeTier(p);
      if (tier === "durable" && p.status !== "rejected") {
        durableEntries.push([id, p]);
      } else if (p.status === "approved" && !p.autoApproved) {
        // keep-forever: manual approvals bypass decay and cap
      } else {
        const signals = scoreSignals(p, this.config, now, tier);
        evaluable.push([id, p, signals.memoryStrength, signals.decayedScore]);
      }
    }

    // Collect every id to evict across all three stages, then forget them in a
    // single batched pass so the orphan-relation cleanup runs once (O(n+k)),
    // not once per pruned pattern (O(k·n)). Stages classify into disjoint id
    // sets (durable vs evaluable), so the collected ids are unique.
    const toForget = [];

    // Stage 1: cap durable by count
    if (durableEntries.length > durableMax) {
      durableEntries.sort((a, b) =>
        String(b[1].lastSeen || b[1].firstSeen || "")
          .localeCompare(String(a[1].lastSeen || a[1].firstSeen || "")));
      for (const [id] of durableEntries.slice(durableMax)) toForget.push(id);
    }

    // Stage 2: score-floor prune evaluable patterns
    const survivors = [];
    for (const [id, p, strength, decayed] of evaluable) {
      if (decayed < 1) toForget.push(id);
      else survivors.push([id, p, strength]);
    }

    // Stage 3: strength-based cap for remaining evaluable
    if (survivors.length > MAX_PATTERN_COUNT * 2) {
      survivors.sort((a, b) => b[2] - a[2]);
      for (let i = MAX_PATTERN_COUNT * 2; i < survivors.length; i++) toForget.push(survivors[i][0]);
    }

    this._forgetPatterns(toForget);
    return toForget.length;
  }

  /**
   * Return all non-rejected, non-ephemeral patterns decorated with computed
   * fields (knowledgeTier, status, decayedScore, injectable), sorted by
   * decayedScore descending. Cached until the next mutation or invalidate().
   *
   * @returns {Array<object>}
   */
  all() {
    if (!this._cacheDirty && this._cachedAll) return this._cachedAll;

    // Single-pass filter + decorate: avoids the intermediate filtered array.
    // mutate=false is required so the cached result is isolated from direct
    // mutations to this.patterns (auto-approve, score boosts, etc.).
    this._cachedAll = decoratePatterns(this.patterns.values(), this.config, {
      filter: (pattern) => {
        if (knowledgeTier(pattern) === "ephemeral") return false;
        if (pattern.type === "workflow" && Array.isArray(pattern.tools) && pattern.tools.length >= 2) {
          if (!hasMultipleDistinctValues(pattern.tools)) return false;
        }
        return true;
      },
    });

    this._cacheDirty = false;
    return this._cachedAll;
  }

  highConfidence() {
    return firstMatching(this.all(), (p) => p.injectable);
  }

  prefs() {
    return firstMatching(this.all(), (p) => p.type === "preference" && p.fix && p.injectable);
  }
}
