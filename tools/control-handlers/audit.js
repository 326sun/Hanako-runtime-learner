// Audit / benchmark control handlers (C-001 HANDLERS split — audit domain).
//
// Extracted verbatim from tools/control.js: run_benchmarks, export_audit_bundle,
// generate_audit_dashboard. They take (input, p[, config, patterns]) and write
// derived audit/benchmark artifacts (+ an event-log entry) under p.learnerDir.
// They own NO permission/side-effect decisions — control.js keeps the action
// dispatch, the *_ACTIONS classification sets, describeControlSideEffect and
// sessionPermission. Moving them here removes the audit-bundle / audit-dashboard
// / benchmark-corpus / facts imports from control.js (import-budget relief).

import path from "path";
import { appendEvent, readEvents, cachedEventSummary } from "../../lib/event-log.js";
import { listProposals } from "../../lib/proposals.js";
import { listReviews } from "../../lib/review-queue.js";
import { loadFacts } from "../../lib/facts.js";
import { buildAuditBundle, exportAuditBundle } from "../../lib/audit-bundle.js";
import { buildAuditDashboard, exportAuditDashboard, findLatestExportedDashboard } from "../../lib/audit-dashboard.js";
import { runBenchmarkCorpus } from "../../lib/benchmark-corpus.js";
import { listTransferCandidateRecords } from "../../lib/transfer-registry.js";
import { resolveProjectRoot } from "../../lib/project-root.js";
import { runDoctorFromDisk } from "../doctor.js";
import { readPluginVersion } from "../_shared.js";

export const auditHandlers = {
  async run_benchmarks(input, p, config) {
    const outputDir = input.benchmarkOutputDir || path.join(p.learnerDir, "benchmark-runs", new Date().toISOString().replace(/[:.]/g, "-"));
    const root = resolveProjectRoot(input, p, { requireBenchmarkCorpus: true });
    if (!root.ok) {
      appendEvent(p.learnerDir, { type: "benchmark.unavailable", entityType: "benchmark", entityId: path.basename(outputDir), summary: "Benchmark corpus unavailable in runtime package", data: { outputDir, reason: root.reason, checked: root.checked } });
      return JSON.stringify({ ok: false, status: "unavailable", outputDir, reason: root.reason, checked: root.checked, nextAction: "provide projectRoot/sourceRoot or install from a source checkout with .source-root.json" }, null, 2);
    }
    const result = await runBenchmarkCorpus({
      projectRoot: root.projectRoot,
      benchmarkRoot: path.join(root.projectRoot, "benchmarks"),
      ids: input.benchmarkId || input.id ? [input.benchmarkId || input.id] : [],
      outputDir,
    }, { pluginDir: root.projectRoot, learnerDir: p.learnerDir, config });
    appendEvent(p.learnerDir, { type: "benchmark.ran", entityType: "benchmark", entityId: path.basename(outputDir), summary: `Ran benchmark corpus: ${result.runs?.length || 0} scenario(s), ok=${result.ok}`, data: { outputDir, projectRoot: root.projectRoot, projectRootSource: root.source, metrics: result.metrics, regressions: result.regressions || [] } });
    return JSON.stringify({ ok: result.ok, outputDir, projectRoot: root.projectRoot, projectRootSource: root.source, metrics: result.metrics, regressions: result.regressions || [], nextAction: "review benchmark-report.md" }, null, 2);
  },

  export_audit_bundle(input, p, config, patterns) {
    // P8.D: every governance data source is staged/capped by the same caller
    // `limit`, so a large audit history doesn't force the full set into an
    // explicit, one-off export. Events keep a higher default (5000) since a
    // replay summary is meaningful only over a wider window; the others
    // default to 500, matching their prior hardcoded value.
    const listLimit = input.limit || 500;
    const proposals = listProposals(p.learnerDir, { limit: listLimit });
    const reviews = listReviews(p.learnerDir, { limit: listLimit });
    const events = readEvents(p.learnerDir, { limit: input.limit || 5000 });
    const facts = loadFacts(p.learnerDir, { limit: listLimit });
    const doctorReport = runDoctorFromDisk(p.learnerDir);
    const transferCandidates = listTransferCandidateRecords(p.learnerDir, { limit: listLimit });
    const version = readPluginVersion(p.pluginDir);
    const eventSummaryLimit = input.limit || 5000;
    const bundle = buildAuditBundle({ version, config, patterns, facts, proposals, reviews, events, eventSummary: cachedEventSummary(p.learnerDir, { limit: eventSummaryLimit, events }), doctor: doctorReport, transferCandidates });
    const written = exportAuditBundle(p.learnerDir, bundle);
    appendEvent(p.learnerDir, { type: "audit.exported", entityType: "audit", entityId: path.basename(written.dir), summary: "Exported local audit bundle", data: { dir: written.dir, doctorStatus: doctorReport.status } });
    return JSON.stringify({ ok: true, ...written, summary: bundle.summary, nextAction: "review audit-report.md" }, null, 2);
  },

  generate_audit_dashboard(input, p) {
    // Only take the reuse shortcut for a plain "give me the dashboard" call —
    // an explicit benchmark override signals the caller wants fresh data for
    // that specific input, not whatever was last exported.
    if (!input.regenerate && !input.benchmarkReportPath && !input.benchmarkRunsDir) {
      const reused = findLatestExportedDashboard(p.learnerDir);
      if (reused) {
        return JSON.stringify({ ok: true, ...reused, nextAction: "review dashboard.md or export_audit_bundle; pass regenerate:true for a fresh rebuild" }, null, 2);
      }
    }
    const root = resolveProjectRoot(input, p, { requireBenchmarkCorpus: true });
    const version = readPluginVersion(root.ok ? root.projectRoot : p.pluginDir);
    const benchmarkRunsDir = input.benchmarkRunsDir || path.join(p.learnerDir, "benchmark-runs");
    const dashboard = buildAuditDashboard(p.learnerDir, { version, limit: input.limit || 50, benchmarkRunsDir, benchmarkReportPath: input.benchmarkReportPath });
    if (!dashboard.benchmark?.available && root.ok) dashboard.benchmark.sourceProjectRoot = root.projectRoot;
    const written = exportAuditDashboard(p.learnerDir, dashboard, { name: input.id || undefined, version });
    appendEvent(p.learnerDir, { type: "audit.dashboard_generated", entityType: "audit_dashboard", entityId: path.basename(written.dir), summary: `Generated audit dashboard: posture=${written.safetyPosture}`, data: { dir: written.dir, summary: written.summary, recommendations: written.recommendations } });
    return JSON.stringify({ ok: true, ...written, nextAction: "review dashboard.md or export_audit_bundle" }, null, 2);
  },
};
