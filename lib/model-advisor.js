import path from "path";
import { learnerDir, readJson, writeJson, knowledgeTier } from "./common.js";
import { resolveOfficialUtilityAdvisorConfig } from "./official-utility-model.js";
import { mergeAdvisorSuggestions, buildHighRiskAdvisorCodePatchProposals } from "./advisor-insights.js";

export const MODEL_ADVICE_FILE = path.join(learnerDir(), "model_advice.json");
const MODEL_ADVICE_STATE_FILE = path.join(learnerDir(), "model_advice_state.json");

// Official host-side utility-model sampling (Hanako ≥ 0.305, EventBus
// capability `model:sample-text`). When available we let the host call the
// configured utility model itself — no provider credentials ever pass through
// this plugin. The legacy path (scraping preferences.json / added-models.yaml
// for an OpenAI-compatible endpoint) remains as a fallback for older hosts.
export const SAMPLE_TEXT_CAPABILITY = "model:sample-text";

function busSampleAvailable(ctx) {
  const bus = ctx?.bus;
  if (!bus || typeof bus.request !== "function") return false;
  try {
    const cap = bus.getCapability?.(SAMPLE_TEXT_CAPABILITY);
    if (cap) return cap.available !== false;
  } catch {}
  try {
    if (bus.hasHandler?.(SAMPLE_TEXT_CAPABILITY)) return true;
  } catch {}
  return false;
}

export function normalizeBaseUrl(baseUrl) {
  const raw = String(baseUrl || "").trim().replace(/\/+$/, "");
  if (!raw) return "";
  if (raw.endsWith("/chat/completions")) return raw;
  if (raw.endsWith("/v1")) return `${raw}/chat/completions`;
  return `${raw}/v1/chat/completions`;
}

export function advisorEndpointWarning(baseUrl) {
  const raw = String(baseUrl || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    const isLocal = host === "localhost" || host === "127.0.0.1" || host === "::1" || host.endsWith(".localhost");
    if (url.protocol === "http:" && !isLocal) return "model advisor endpoint uses non-local HTTP; pattern metadata may cross the network without TLS";
  } catch {}
  return "";
}

function compactPattern(pattern) {
  return {
    id: pattern.id,
    type: pattern.type,
    status: pattern.status,
    count: pattern.count,
    score: pattern.decayedScore ?? pattern.score,
    desc: pattern.desc,
    fix: pattern.fix || "",
  };
}

function extractJson(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {}
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

function shouldRun(config, { patternIds = [], ctx = null } = {}) {
  if (!config.modelAdvisorEnabled) return { ok: false, reason: "disabled" };
  const resolved = resolveAdvisorConfig(config, ctx);
  if (!resolved.ok) return resolved;

  const state = readJson(MODEL_ADVICE_STATE_FILE, {});
  const minMs = Math.max(1, Number(config.modelAdvisorMinIntervalMinutes || 60)) * 60_000;
  if (state.lastRunAt && Date.now() - Date.parse(state.lastRunAt) < minMs) {
    return { ok: false, reason: "rate limited" };
  }
  // Data-driven gate: skip unless enough *genuinely new* patterns have appeared
  // since the last run. We compare pattern IDs, not the total count: a churning
  // set (e.g. +3 new / -3 pruned) leaves the count unchanged and a shrinking set
  // makes a count delta go negative, both of which would wrongly suppress the
  // advisor forever. Counting IDs absent from the last run is immune to pruning.
  const minDelta = Math.max(0, Number(config.minAdvisorNewPatterns || 3));
  if (minDelta > 0 && Array.isArray(state.lastPatternIds)) {
    const seen = new Set(state.lastPatternIds);
    const newCount = patternIds.reduce((n, id) => (seen.has(id) ? n : n + 1), 0);
    if (newCount < minDelta) {
      return { ok: false, reason: `only ${newCount} new pattern(s), need ${minDelta}` };
    }
  }
  return { ok: true, config: resolved.config };
}

export function resolveAdvisorConfig(config, ctx = null) {
  const source = config.modelAdvisorSource || "official";
  if (source === "off") return { ok: false, reason: "advisor source is off" };

  if (source === "official") {
    // Preferred: host-side sampling. The host resolves the utility model and
    // its credentials internally; the plugin only ships the prompt.
    if (busSampleAvailable(ctx)) {
      return {
        ok: true,
        config: {
          ...config,
          useBusSampling: true,
          modelAdvisorResolvedSource: "official-bus",
          modelAdvisorResolvedProvider: "hanako",
        },
      };
    }
    const official = resolveOfficialUtilityAdvisorConfig();
    if (official.ok) return { ok: true, config: { ...config, ...official.config } };
    if (!config.modelAdvisorBaseUrl && !config.modelAdvisorModel && !config.modelAdvisorApiKey) {
      return official;
    }
  }

  if (!config.modelAdvisorBaseUrl || !config.modelAdvisorModel) return { ok: false, reason: "model advisor endpoint incomplete" };
  if (!config.modelAdvisorApiKey) return { ok: false, reason: "model advisor api key missing" };
  const warning = advisorEndpointWarning(config.modelAdvisorBaseUrl);
  return {
    ok: true,
    config: {
      ...config,
      modelAdvisorResolvedSource: source === "official" ? "private-fallback" : "private",
      ...(warning ? { modelAdvisorEndpointWarning: warning } : {}),
    },
  };
}

async function sampleViaBus(ctx, prompt, maxTokens) {
  const result = await ctx.bus.request(SAMPLE_TEXT_CAPABILITY, {
    operation: "self-learning-model-advisor",
    messages: [
      { role: "system", content: "Return compact JSON only. Be conservative." },
      { role: "user", content: prompt },
    ],
    maxTokens,
  }, { timeout: 30_000 });
  const text = result?.text ?? result?.content ?? result?.output_text ?? "";
  if (!String(text).trim()) throw new Error("model:sample-text returned an empty response");
  return { text: String(text), model: result?.model || result?.modelId || "official-utility" };
}

async function sampleViaHttp(runtimeConfig, prompt, maxTokens) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);

  let res;
  try {
    res = await fetch(normalizeBaseUrl(runtimeConfig.modelAdvisorBaseUrl), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${runtimeConfig.modelAdvisorApiKey}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: runtimeConfig.modelAdvisorModel,
        messages: [
          { role: "system", content: "Return compact JSON only. Be conservative." },
          { role: "user", content: prompt },
        ],
        max_tokens: maxTokens,
        temperature: 0.2,
      }),
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    throw new Error(`model advisor failed: HTTP ${res.status}`);
  }

  const data = await res.json();
  return {
    text: data.choices?.[0]?.message?.content || data.output_text || "",
    model: runtimeConfig.modelAdvisorModel,
  };
}

export async function runModelAdvisor({ config, patterns = [], usage = null, capabilities = null, reason = "scheduled", ctx = null }) {
  const patternIds = patterns.map((p) => p.id).filter(Boolean);
  const gate = shouldRun(config, { patternIds, ctx });
  if (!gate.ok) return { ok: false, skipped: true, reason: gate.reason };
  let runtimeConfig = gate.config;

  const candidates = patterns
    // Privacy: never send preference / durable patterns to the external model.
    // These carry the rawest user text — user corrections and pin_memory
    // content — so they stay local. Only workflow/error/usage patterns, which
    // are tool-shaped and non-sensitive, are eligible for distillation.
    .filter((pattern) => pattern.status !== "rejected"
      && pattern.type !== "preference"
      && knowledgeTier(pattern) !== "durable")
    .sort((a, b) => (b.decayedScore || b.score || 0) - (a.decayedScore || a.score || 0))
    .slice(0, 12)
    .map(compactPattern);

  if (candidates.length === 0) return { ok: false, skipped: true, reason: "no candidate patterns" };

  const prompt = [
    "You are a low-cost background advisor for a self-learning plugin.",
    "Summarize candidate improvements conservatively. Do not invent facts. Do not request private prompts or paths.",
    "Return JSON only with shape: {\"suggestions\":[{\"patternId\":\"...\",\"title\":\"...\",\"advice\":\"...\",\"risk\":\"low|medium|high\"}]}",
    "",
    JSON.stringify({
      reason,
      patterns: candidates,
      usage: runtimeConfig.includeUsageInAdvisorPrompt === true && usage ? {
        totalRequests: usage.totalRequests,
        totalTokens: usage.totalTokens,
        status: usage.status,
        topModels: Object.entries(usage.byModel || {}).slice(0, 5),
      } : null,
      capabilities: capabilities ? {
        count: capabilities.count,
        availableCount: capabilities.availableCount,
      } : null,
    }),
  ].join("\n");

  const maxTokens = Math.max(64, Number(runtimeConfig.modelAdvisorMaxTokens || 500));

  let sampled;
  if (runtimeConfig.useBusSampling) {
    try {
      sampled = await sampleViaBus(ctx, prompt, maxTokens);
    } catch (busErr) {
      // Host sampling failed (busy session, transient bus error, schema drift).
      // One-shot fallback to the legacy HTTP resolution — same chain as on an
      // old host: scraped official credentials first, then the private endpoint.
      ctx?.log?.info?.(`runtime-learner: model advisor bus sampling failed (${busErr?.message || "unknown"}), falling back to HTTP`);
      const fallback = resolveAdvisorConfig({ ...config, modelAdvisorSource: config.modelAdvisorSource || "official" }, null);
      if (!fallback.ok) throw busErr;
      runtimeConfig = fallback.config;
      ctx?.log?.info?.(`runtime-learner: model advisor HTTP fallback source=${runtimeConfig.modelAdvisorResolvedSource || "unknown"}`);
      sampled = await sampleViaHttp(runtimeConfig, prompt, maxTokens);
    }
  } else {
    sampled = await sampleViaHttp(runtimeConfig, prompt, maxTokens);
  }

  const parsed = extractJson(sampled.text) || { suggestions: [] };
  const advice = {
    updatedAt: new Date().toISOString(),
    reason,
    source: runtimeConfig.modelAdvisorResolvedSource || config.modelAdvisorSource || "official",
    provider: runtimeConfig.modelAdvisorResolvedProvider || null,
    model: sampled.model || runtimeConfig.modelAdvisorModel || null,
    warning: runtimeConfig.modelAdvisorEndpointWarning || null,
    suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions.slice(0, 12) : [],
  };
  writeJson(MODEL_ADVICE_FILE, advice);
  writeJson(MODEL_ADVICE_STATE_FILE, { lastRunAt: advice.updatedAt, lastPatternIds: patternIds });
  return { ok: true, advice };
}

/**
 * Factory for the advisor runner closure used in the plugin entry (index.js).
 * Keeps the in-flight guard and skip-cache internal so the caller only calls
 * `runner.maybeRun(reason, sessionPath, cachedAll)`.
 */
export function createAdvisorRunner({
  getConfig,
  detector,
  refreshSkill,
  logActivity,
  runtimeState,
  ctx,
  notifyProposalReview,
  notifyWorkStatus,
  dataDir,
  usageSummaryFile,
  capabilitiesFile,
}) {
  const _cachedAdvisorSkip = (reason) => {
    const key = reason || "unknown";
    const cached = runtimeState.advisorSkipReasons.get(key);
    if (cached && Date.now() - cached < 30 * 60_000) return true;
    runtimeState.advisorSkipReasons.set(key, Date.now());
    return false;
  };

  let _inFlight = false;

  async function maybeRun(reason, sessionPath = null, cachedAll = null) {
    const config = getConfig();
    if (!config.modelAdvisorEnabled) return;
    if (_inFlight) return;
    _inFlight = true;
    try {
      const result = await runModelAdvisor({
        config,
        patterns: cachedAll || detector.all(),
        usage: readJson(usageSummaryFile, null),
        capabilities: readJson(capabilitiesFile, null),
        reason,
        ctx,
      });
      if (result.ok) {
        const count = result.advice?.suggestions?.length || 0;
        if (count > 0) {
          logActivity({
            type: "model_advisor",
            summary: `Model advisor generated ${count} suggestions (source: ${result.advice?.source || "unknown"})`,
            detail: result.advice?.suggestions?.slice(0, 3).map((s) => s.title).join(", ") || null,
            sessionPath,
          });
          runtimeState.sessionActivityCount += 1;
          ctx.log.info(`runtime-learner: model advisor generated ${count} suggestions`);
          const { merged } = mergeAdvisorSuggestions(detector.patterns, result.advice);
          if (merged > 0) {
            ctx.log.info(`runtime-learner: merged ${merged} advisor insights into patterns`);
            detector.invalidate();
            refreshSkill(true, sessionPath);
          }
          const { proposals, created } = buildHighRiskAdvisorCodePatchProposals({
            learnerDir: dataDir,
            patterns: detector.patterns,
            adviceOrSuggestions: result.advice,
          });
          if (proposals.length > 0) {
            if (created > 0) {
              logActivity({
                type: "proposal_created",
                summary: `Model advisor flagged ${created} high-risk pattern(s) for review`,
                sessionPath,
              });
              runtimeState.sessionActivityCount += 1;
            }
            void notifyProposalReview(sessionPath, proposals);
          }
        }
        await notifyWorkStatus(sessionPath, count > 0 ? `已生成 ${count} 条候选建议` : "已完成");
      } else if (!_cachedAdvisorSkip(result.reason)) {
        const isConfigIssue = /(?:not configured|incomplete|missing|provider is missing)/i.test(result.reason);
        if (isConfigIssue) {
          ctx.log.info(`runtime-learner: model advisor dormant — ${result.reason}. Configure a utility model in Hanako settings to enable it.`);
        } else {
          ctx.log.info(`runtime-learner: model advisor skipped: ${result.reason}`);
        }
      }
    } catch (err) {
      if (!_cachedAdvisorSkip(err.message || "unknown")) {
        ctx.log.warn(`runtime-learner: model advisor skipped: ${err.message}`);
      }
    } finally {
      _inFlight = false;
    }
  }

  return { maybeRun };
}
