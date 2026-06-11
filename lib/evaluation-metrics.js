function avg(values) {
  const nums = values.map(Number).filter(Number.isFinite);
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
}

function rate(numerator, denominator) {
  return denominator ? numerator / denominator : null;
}

export function calculateEvaluationMetrics(runs = []) {
  const total = runs.length;
  const taskSuccess = runs.filter((r) => r.status === "succeeded" || r.ok === true).length;
  const auto = runs.filter((r) => r.autoApplied === true || r.autoExecuted === true);
  const autoSuccess = auto.filter((r) => r.status === "succeeded" || r.ok === true).length;
  const rollback = runs.filter((r) => r.rollbackAttempted === true);
  const rollbackSuccess = rollback.filter((r) => r.rollbackOk === true).length;
  const repair = runs.filter((r) => r.repairAttempted === true);
  const repairSuccess = repair.filter((r) => r.repairOk === true).length;
  const falseAuto = auto.filter((r) => r.falseAutoApply === true || r.status === "unsafe_auto_apply").length;
  const manual = runs.filter((r) => r.manualEscalated === true || r.status === "manual_confirm").length;
  return {
    total,
    task_success_rate: rate(taskSuccess, total),
    auto_execution_success_rate: rate(autoSuccess, auto.length),
    rollback_success_rate: rate(rollbackSuccess, rollback.length),
    repair_success_rate: rate(repairSuccess, repair.length),
    false_auto_apply_rate: rate(falseAuto, auto.length),
    manual_escalation_rate: rate(manual, total),
    token_overhead: avg(runs.map((r) => r.tokenOverhead)),
    latency_overhead: avg(runs.map((r) => r.latencyMs || r.durationMs)),
    skill_effectiveness: avg(runs.map((r) => r.skillEffectiveness)),
  };
}

export function compareMetrics(current = {}, baseline = {}) {
  const comparison = {};
  for (const key of new Set([...Object.keys(current), ...Object.keys(baseline)])) {
    if (typeof current[key] === "number" && typeof baseline[key] === "number") {
      comparison[key] = { current: current[key], baseline: baseline[key], delta: current[key] - baseline[key] };
    }
  }
  return comparison;
}

export function detectMetricRegressions(current = {}, baseline = {}, thresholds = {}) {
  const regressions = [];
  const higherIsBetter = new Set(["task_success_rate", "auto_execution_success_rate", "rollback_success_rate", "repair_success_rate", "skill_effectiveness"]);
  const lowerIsBetter = new Set(["false_auto_apply_rate", "manual_escalation_rate", "token_overhead", "latency_overhead"]);
  for (const key of [...higherIsBetter, ...lowerIsBetter]) {
    if (typeof current[key] !== "number" || typeof baseline[key] !== "number") continue;
    const tolerance = Number(thresholds[key] ?? 0.000001);
    const delta = current[key] - baseline[key];
    if (higherIsBetter.has(key) && delta < -tolerance) regressions.push({ metric: key, direction: "lower", delta, current: current[key], baseline: baseline[key] });
    if (lowerIsBetter.has(key) && delta > tolerance) regressions.push({ metric: key, direction: "higher", delta, current: current[key], baseline: baseline[key] });
  }
  return regressions;
}
