import path from "path";
import { learnerDir, readJson, writeJson } from "./common.js";
import { resolveOfficialUtilityAdvisorConfig } from "./official-utility-model.js";
import {
  buildAdvice,
  buildAdvisorPrompt,
  buildHighRiskAdvisorCodePatchProposals,
  mergeAdvisorSuggestions,
  selectAdvisorCandidates,
} from "./advisor-insights.js";
import { CREDENTIAL_PLACEHOLDER } from "./credentials.js";
import { normalizeSessionTarget } from "./helpers.js";
import { SAMPLE_TEXT_CAPABILITY, busSampleAvailable, sampleTextViaBus } from "./sample-text.js";

// Re-exported for callers/tests that reference advisor.SAMPLE_TEXT_CAPABILITY.
export { SAMPLE_TEXT_CAPABILITY };

export const MODEL_ADVICE_FILE = path.join(learnerDir(), "model_advice.json");
const MODEL_ADVICE_STATE_FILE = path.join(learnerDir(), "model_advice_state.json");

export function modelAdviceFile(dataDir = learnerDir()) {
  return path.join(dataDir, "model_advice.json");
}

function modelAdviceStateFile(dataDir = learnerDir()) {
  return path.join(dataDir, "model_advice_state.json");
}

// Official host-side utility-model sampling (Hanako ≥ 0.305, EventBus
// capability `model:sample-text`). When available we let the host call the
// configured utility model itself — no provider credentials ever pass through
// this plugin. The legacy path (scraping preferences.json / added-models.yaml
// for an OpenAI-compatible endpoint) remains as a fallback for older hosts.
// SAMPLE_TEXT_CAPABILITY / busSampleAvailable now live in ./sample-text.js so the
// advisor and the v5 LLM extractor share one capability-probe surface.

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

/**
 * Build the persisted advisor-status record from a run outcome. Pure so the
 * consecutive-failure accounting is unit-testable without the runner's deps.
 *
 * `consecutiveFailures` lets the doctor distinguish a one-off transient blip
 * (warning) from a persistently broken advisor (high). It counts only errors:
 *   success → reset to 0; error → prior + 1; skipped → preserved (a benign
 *   gate skip such as "rate limited" must not mask an ongoing error streak).
 */
export function buildAdvisorStatus({ outcome, prev = null, lastRunAt, reason = null, source = null, suggestionCount = 0 }) {
  const priorFailures = Number(prev?.consecutiveFailures) || 0;
  if (outcome === "success") {
    return { lastRunAt, status: "success", reason: null, source: source || "unknown", suggestionCount, consecutiveFailures: 0 };
  }
  if (outcome === "skipped") {
    return { lastRunAt, status: "skipped", reason: reason || "unknown", source: null, suggestionCount: 0, consecutiveFailures: priorFailures };
  }
  return { lastRunAt, status: "error", reason: reason || "unknown", source: null, suggestionCount: 0, consecutiveFailures: priorFailures + 1 };
}

function shouldRun(config, { patternIds = [], ctx = null, stateFile = MODEL_ADVICE_STATE_FILE } = {}) {
  if (!config.modelAdvisorEnabled) return { ok: false, reason: "disabled" };
  const resolved = resolveAdvisorConfig(config, ctx);
  if (!resolved.ok) return resolved;

  const state = readJson(stateFile, {});
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
  // The placeholder means the real key is in the encrypted store but this config
  // was read without mergeCredentials(). Treat it as missing rather than sending
  // the literal placeholder as a bearer token (which fails with HTTP 401).
  if (!config.modelAdvisorApiKey || config.modelAdvisorApiKey === CREDENTIAL_PLACEHOLDER) {
    return { ok: false, reason: "model advisor api key missing" };
  }
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
  return sampleTextViaBus(ctx, {
    operation: "self-learning-model-advisor",
    messages: [
      { role: "system", content: "Return compact JSON only. Be conservative." },
      { role: "user", content: prompt },
    ],
    maxTokens,
    timeout: 30_000,
  });
}

async function sampleViaHttp(runtimeConfig, prompt, maxTokens) {
  const url = normalizeBaseUrl(runtimeConfig.modelAdvisorBaseUrl);
  const body = JSON.stringify({
    model: runtimeConfig.modelAdvisorModel,
    messages: [
      { role: "system", content: "Return compact JSON only. Be conservative." },
      { role: "user", content: prompt },
    ],
    max_tokens: maxTokens,
    temperature: 0.2,
  });
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${runtimeConfig.modelAdvisorApiKey}`,
  };

  // Use direct global fetch for the user-configured fallback endpoint. The
  // host's declarative ctx.network.fetch channel requires a static manifest
  // allowedHosts allowlist and cannot express the arbitrary base URL a user
  // types here, so routing through it would reject every request on v0.341+
  // hosts. The host explicitly keeps direct fetch() compatible for this case.
  const doFetch = typeof fetch === "function" ? fetch : null;
  if (!doFetch) throw new Error("model advisor requires a global fetch implementation");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  let res;
  try {
    res = await doFetch(url, { method: "POST", headers, signal: controller.signal, body });
  } finally {
    clearTimeout(timeout);
  }
  if (!res.ok) throw new Error(`model advisor failed: HTTP ${res.status}`);
  const data = await res.json();

  return {
    text: data.choices?.[0]?.message?.content || data.output_text || "",
    model: runtimeConfig.modelAdvisorModel,
  };
}

async function sampleWithResolvedConfig({ runtimeConfig, config, ctx, prompt, maxTokens }) {
  if (!runtimeConfig.useBusSampling) {
    return { runtimeConfig, sampled: await sampleViaHttp(runtimeConfig, prompt, maxTokens) };
  }

  try {
    return { runtimeConfig, sampled: await sampleViaBus(ctx, prompt, maxTokens) };
  } catch (busErr) {
    // Host sampling failed (busy session, transient bus error, schema drift).
    // One-shot fallback to the legacy HTTP resolution — same chain as on an
    // old host: scraped official credentials first, then the private endpoint.
    ctx?.log?.info?.(`runtime-learner: model advisor bus sampling failed (${busErr?.message || "unknown"}), falling back to HTTP`);
    const fallback = resolveAdvisorConfig({ ...config, modelAdvisorSource: config.modelAdvisorSource || "official" }, null);
    if (!fallback.ok) throw busErr;
    const fallbackConfig = fallback.config;
    ctx?.log?.info?.(`runtime-learner: model advisor HTTP fallback source=${fallbackConfig.modelAdvisorResolvedSource || "unknown"}`);
    return { runtimeConfig: fallbackConfig, sampled: await sampleViaHttp(fallbackConfig, prompt, maxTokens) };
  }
}

export async function runModelAdvisor({ config, patterns = [], usage = null, capabilities = null, reason = "scheduled", ctx = null, dataDir = null, adviceFile = null, stateFile = null }) {
  const resolvedAdviceFile = adviceFile || modelAdviceFile(dataDir || learnerDir());
  const resolvedStateFile = stateFile || modelAdviceStateFile(dataDir || learnerDir());
  const patternIds = patterns.map((p) => p.id).filter(Boolean);
  const gate = shouldRun(config, { patternIds, ctx, stateFile: resolvedStateFile });
  if (!gate.ok) return { ok: false, skipped: true, reason: gate.reason };
  let runtimeConfig = gate.config;

  const candidates = selectAdvisorCandidates(patterns);
  if (candidates.length === 0) return { ok: false, skipped: true, reason: "no candidate patterns" };

  const prompt = buildAdvisorPrompt({ reason, candidates, usage, capabilities, runtimeConfig });
  const maxTokens = Math.max(64, Number(runtimeConfig.modelAdvisorMaxTokens || 500));
  const sampledResult = await sampleWithResolvedConfig({ runtimeConfig, config, ctx, prompt, maxTokens });
  runtimeConfig = sampledResult.runtimeConfig;
  const advice = buildAdvice({ runtimeConfig, config, sampled: sampledResult.sampled, reason });
  writeJson(resolvedAdviceFile, advice);
  writeJson(resolvedStateFile, { lastRunAt: advice.updatedAt, lastPatternIds: patternIds });
  return { ok: true, advice };
}

/**
 * Factory for the advisor runner closure used in the plugin entry (index.js).
 * Keeps the in-flight guard and skip-cache internal so the caller only calls
 * `runner.maybeRun(reason, sessionHandle, cachedAll)`.
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

  const advisorStatusFile = path.join(dataDir, "model_advisor_status.json");

  let _inFlight = false;

  async function maybeRun(reason, sessionHandle = null, cachedAll = null) {
    const config = getConfig();
    if (!config.modelAdvisorEnabled) return;
    if (_inFlight) return;
    _inFlight = true;
    const lastRunAt = new Date().toISOString();
    const prevStatus = readJson(advisorStatusFile, null);
    try {
      const session = normalizeSessionTarget(sessionHandle);
      const result = await runModelAdvisor({
        config,
        patterns: cachedAll || detector.all(),
        usage: readJson(usageSummaryFile, null),
        capabilities: readJson(capabilitiesFile, null),
        reason,
        ctx,
        dataDir,
      });
      if (result.ok) {
        const count = result.advice?.suggestions?.length || 0;
        writeJson(advisorStatusFile, buildAdvisorStatus({
          outcome: "success", prev: prevStatus, lastRunAt,
          source: result.advice?.source, suggestionCount: count,
        }));
        if (count > 0) {
          logActivity({
            type: "model_advisor",
            summary: `Model advisor generated ${count} suggestions (source: ${result.advice?.source || "unknown"})`,
            detail: result.advice?.suggestions?.slice(0, 3).map((s) => s.title).join(", ") || null,
            sessionId: session.sessionId,
            sessionRef: session.sessionRef,
            sessionPath: session.sessionPath,
          });
          runtimeState.sessionActivityCount += 1;
          ctx.log.info(`runtime-learner: model advisor generated ${count} suggestions`);
          const { merged } = mergeAdvisorSuggestions(detector.patterns, result.advice);
          if (merged > 0) {
            ctx.log.info(`runtime-learner: merged ${merged} advisor insights into patterns`);
            detector.invalidate();
            refreshSkill(true, sessionHandle);
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
                sessionId: session.sessionId,
                sessionRef: session.sessionRef,
                sessionPath: session.sessionPath,
              });
              runtimeState.sessionActivityCount += 1;
            }
            void notifyProposalReview(sessionHandle, proposals);
          }
        }
        await notifyWorkStatus(sessionHandle, count > 0 ? `已生成 ${count} 条候选建议` : "已完成");
      } else {
        writeJson(advisorStatusFile, buildAdvisorStatus({
          outcome: "skipped", prev: prevStatus, lastRunAt, reason: result.reason,
        }));
        if (!_cachedAdvisorSkip(result.reason)) {
          const isConfigIssue = /(?:not configured|incomplete|missing|provider is missing)/i.test(result.reason);
          if (isConfigIssue) {
            ctx.log.info(`runtime-learner: model advisor dormant — ${result.reason}. Configure a utility model in Hanako settings to enable it.`);
          } else {
            ctx.log.info(`runtime-learner: model advisor skipped: ${result.reason}`);
          }
        }
      }
    } catch (err) {
      writeJson(advisorStatusFile, buildAdvisorStatus({
        outcome: "error", prev: prevStatus, lastRunAt, reason: err.message,
      }));
      if (!_cachedAdvisorSkip(err.message || "unknown")) {
        ctx.log.warn(`runtime-learner: model advisor skipped: ${err.message}`);
      }
    } finally {
      _inFlight = false;
    }
  }

  return { maybeRun };
}
