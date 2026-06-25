/**
 * llm-extractor — turns one extraction job into a validated pattern candidate
 * by sampling the host utility model (plan §5.6 / §5.7 / §5.8).
 *
 * Fail-soft contract — this never throws into the worker:
 *   { ok:true,  extraction }                      → create a proposal
 *   { ok:false, reason:"sample_failed", retriable:true }  → backoff + retry
 *   { ok:false, reason:"none",          retriable:false } → done, no proposal
 *   { ok:false, reason:"unparseable"|"bad_type"|"low_confidence", retriable:false } → discard
 */

import { sampleTextViaBus } from "./sample-text.js";
import { parseExtraction, validateExtraction } from "./llm-extraction-schema.js";

const MAX_OUTPUT_TOKENS = 400;

const SYSTEM_PROMPT = [
  "你是一个保守的交互模式抽取器。只输出一个 JSON 对象，不要解释，不要 markdown 围栏。",
  "你的任务是从脱敏交互摘要中归纳至多 1 条可复用模式。",
  "证据不足时输出 {\"type\":\"none\"}。",
  "你无权决定是否应用，后续有人工和策略门审核。",
  "风险分级必须保守，宁可调高，不得调低动作本身风险。",
].join("\n");

export function buildExtractionPrompt(job) {
  const user = [
    `交互类别提示：${job.kind}`,
    "脱敏交互摘要：",
    job.summary || "",
    "",
    "证据 ID：",
    job.evidenceIds.join(", "),
    "",
    "只输出如下 schema 的 JSON：",
    "{",
    '  "type": "workflow|preference|error|usage|none",',
    '  "desc": "一句话描述该模式",',
    '  "generalization": "何时适用",',
    '  "evidenceIds": ["来自输入的证据 id"],',
    '  "confidence": 0.0,',
    '  "suggestedRiskTier": "R0|R1|R2|R3|R4"',
    "}",
  ].join("\n");
  return { system: SYSTEM_PROMPT, user };
}

export async function extractFromJob(ctx, job, { timeoutMs, minConfidence }) {
  const { system, user } = buildExtractionPrompt(job);
  let sampled;
  try {
    sampled = await sampleTextViaBus(ctx, {
      operation: "self-learning-pattern-extraction",
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      maxTokens: MAX_OUTPUT_TOKENS,
      timeout: timeoutMs,
    });
  } catch {
    // Host busy / transient bus error / timeout / empty response — retriable.
    return { ok: false, reason: "sample_failed", retriable: true };
  }

  const parsed = parseExtraction(sampled.text);
  const result = validateExtraction(parsed, { job, minConfidence });
  if (result.ok) return { ok: true, extraction: result.extraction };
  // none/bad_type/low_confidence/unparseable will not improve on retry.
  return { ok: false, reason: result.reason, retriable: false };
}
