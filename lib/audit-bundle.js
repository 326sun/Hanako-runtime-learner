// Export a portable, local audit bundle for governance review.
// The bundle is a snapshot only; it does not mutate runtime learning state.

import fs from "fs";
import path from "path";
import { countValues, decoratePatterns, DEFAULT_CONFIG } from "./common.js";
import { atomicWriteFileSync } from "./atomic-file.js";

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function redactUrl(value) {
  try {
    const url = new URL(String(value));
    return url.origin;
  } catch {
    return value;
  }
}

function redactConfig(config = {}) {
  const out = { ...config };
  for (const key of Object.keys(out)) {
    if (/api.?key|token|secret|password/i.test(key)) {
      out[key] = out[key] ? "[redacted]" : out[key];
      continue;
    }
    if (/url|endpoint/i.test(key) && typeof out[key] === "string") {
      out[key] = redactUrl(out[key]);
    }
  }
  return out;
}

function scopeProject(pattern) {
  return pattern?.scope?.project || pattern?.context?.project || "general";
}

function renderMarkdown(bundle) {
  const lines = [];
  lines.push(`# Runtime Self-Learning Audit Bundle`);
  lines.push("");
  lines.push(`Generated: ${bundle.generatedAt}`);
  lines.push(`Version: ${bundle.version || "unknown"}`);
  lines.push(`Governance profile: ${bundle.config?.governanceProfile || "balanced"}`);
  lines.push("");
  lines.push("## Doctor");
  lines.push("");
  lines.push(`Status: **${bundle.doctor?.label || bundle.doctor?.status || "unknown"}**`);
  lines.push(`Score: ${bundle.doctor?.score ?? "n/a"}`);
  lines.push(`Issues: ${bundle.doctor?.issues?.length || 0}`);
  lines.push("");
  if (bundle.doctor?.issues?.length) {
    for (const issue of bundle.doctor.issues.slice(0, 20)) {
      lines.push(`- [${issue.severity}] ${issue.type}: ${issue.message}`);
    }
    lines.push("");
  }
  lines.push("## Memory Summary");
  lines.push("");
  lines.push(`Patterns: ${bundle.summary.patterns}`);
  lines.push(`Facts: ${bundle.summary.facts}`);
  lines.push(`Proposals: ${bundle.summary.proposals}`);
  lines.push(`Reviews: ${bundle.summary.reviews}`);
  lines.push(`Events sampled: ${bundle.summary.events}`);
  lines.push(`Transfer candidates: ${bundle.summary.transferCandidates || 0}`);
  lines.push("");
  lines.push("### Pattern scopes");
  lines.push("");
  for (const [project, count] of Object.entries(bundle.scopeDistribution || {})) {
    lines.push(`- ${project}: ${count}`);
  }
  lines.push("");
  lines.push("## Event Replay Summary");
  lines.push("");
  lines.push("```json");
  lines.push(JSON.stringify(bundle.eventSummary || {}, null, 2));
  lines.push("```");
  lines.push("");
  lines.push("## Notes");
  lines.push("");
  lines.push("This bundle redacts API keys/tokens from config and is intended for local review or issue attachment after manual inspection.");
  return lines.join("\n");
}

export function buildAuditBundle({
  version = "unknown",
  config = DEFAULT_CONFIG,
  patterns = [],
  facts = [],
  proposals = [],
  reviews = [],
  events = [],
  eventSummary = {},
  doctor = null,
  transferCandidates = [],
} = {}) {
  const decorated = decoratePatterns(patterns, config);
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    version,
    config: redactConfig(config),
    summary: {
      patterns: decorated.length,
      injectable: decorated.filter((p) => p.injectable).length,
      facts: facts.length,
      proposals: proposals.length,
      reviews: reviews.length,
      events: events.length,
      transferCandidates: transferCandidates.length,
      doctorStatus: doctor?.status || null,
    },
    scopeDistribution: countValues(decorated.map(scopeProject)),
    patternTypes: countValues(decorated.map((p) => p.type)),
    proposalStatus: countValues(proposals.map((p) => p.status)),
    reviewStatus: countValues(reviews.map((r) => r.status)),
    transferCandidateStatus: countValues(transferCandidates.map((r) => r.status)),
    transferCandidates: transferCandidates.map((record) => ({
      id: record.id,
      status: record.status,
      sourceProjectId: record.candidate?.sourceProjectId || null,
      targetProjectId: record.candidate?.targetProjectId || null,
      riskTier: record.candidate?.riskTier || null,
      validationStatus: record.validation?.status || null,
      manualPromotionEligible: !!record.promotion?.manualPromotionEligible,
      autoPromotionBlocked: record.promotion?.autoPromotionBlocked !== false,
    })),
    eventSummary,
    doctor,
  };
}

export function exportAuditBundle(learnerDir, bundle, { name = null } = {}) {
  const dir = path.join(learnerDir, "audit", name || timestamp());
  fs.mkdirSync(dir, { recursive: true });
  const jsonPath = path.join(dir, "audit-bundle.json");
  const mdPath = path.join(dir, "audit-report.md");
  atomicWriteFileSync(jsonPath, JSON.stringify(bundle, null, 2), "utf-8");
  atomicWriteFileSync(mdPath, renderMarkdown(bundle), "utf-8");
  return { dir, jsonPath, mdPath };
}
