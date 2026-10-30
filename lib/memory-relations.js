import { expandQueryTokens } from "../tools/search.js";

const normal = (value) => String(value || "").normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();

export function entityKeys(item = {}) {
  const explicit = Array.isArray(item.entities) ? item.entities : [];
  const aliases = Array.isArray(item.aliases) ? item.aliases : item.metadata?.aliases || [];
  const values = [item.subject, item.object, ...explicit, ...aliases].filter((value) => typeof value === "string");
  return [...new Set(values.map(normal).filter((value) => value.length >= 2))].slice(0, 80);
}

function docText(item) {
  return normal([item.id, item.desc, item.fix, item.summary, item.subject, item.predicate, item.object,
    ...(item.entities || []), ...(item.aliases || item.metadata?.aliases || [])].filter(Boolean).join(" "));
}

export function charNgramVector(text, { min = 2, max = 4, maxNgrams = 6000 } = {}) {
  const normalized = normal(text).replace(/[^\p{L}\p{N}]+/gu, " ");
  const grams = new Map();
  for (const run of normalized.split(" ").filter(Boolean)) {
    const chars = Array.from(run);
    for (let n = min; n <= max; n++) {
      for (let i = 0; i + n <= chars.length; i++) {
        const gram = chars.slice(i, i + n).join("");
        grams.set(gram, (grams.get(gram) || 0) + 1);
        if (grams.size >= maxNgrams) break;
      }
      if (grams.size >= maxNgrams) break;
    }
    if (grams.size >= maxNgrams) break;
  }
  return grams;
}

export function cosineSparse(a, b) {
  if (!a?.size || !b?.size) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (const value of a.values()) normA += value * value;
  for (const value of b.values()) normB += value * value;
  const smaller = a.size < b.size ? a : b, larger = smaller === a ? b : a;
  for (const [key, value] of smaller) dot += value * (larger.get(key) || 0);
  return normA && normB ? dot / Math.sqrt(normA * normB) : 0;
}

export function scoreMemorySignals(items, query, { charEnabled = true, entityEnabled = true, charCandidateLimit = 40, lexicalCandidateIds = new Set() } = {}) {
  const rows = Array.isArray(items) ? items : [];
  const queryText = normal(query);
  const terms = new Set(expandQueryTokens(query).map(normal).filter((term) => term.length >= 2));
  const queryVector = charEnabled ? charNgramVector(queryText) : new Map();
  const entityMatches = new Set();
  const byEntity = new Map();
  for (const item of rows) {
    for (const entity of entityKeys(item)) {
      if (!byEntity.has(entity)) byEntity.set(entity, new Set());
      byEntity.get(entity).add(item.id);
      if (entityEnabled && (queryText.includes(entity) || [...terms].some((term) => entity.includes(term) || term.includes(entity)))) entityMatches.add(entity);
    }
  }
  const directIds = new Set();
  for (const entity of entityMatches) for (const id of byEntity.get(entity) || []) directIds.add(id);
  const allowedIds = new Set(rows.map((row) => row.id));
  const signalCandidateIds = new Set(directIds);
  const charScores = new Map();
  const entityScores = new Map();
  const topChars = [];
  const charLimit = Math.max(1, Math.min(200, Number(charCandidateLimit) || 40));
  for (const item of rows) {
    const rowEntities = entityKeys(item);
    const direct = rowEntities.filter((entity) => entityMatches.has(entity)).length;
    let related = 0;
    if (entityEnabled && !direct) {
      for (const entity of rowEntities) if (byEntity.get(entity)?.size && [...byEntity.get(entity)].some((id) => directIds.has(id))) related += 1;
    }
    if (entityEnabled && Array.isArray(item.relations)) {
      for (const edge of item.relations) if (allowedIds.has(edge.targetId) && directIds.has(edge.targetId)) related += Number(edge.weight ?? 0.2);
    }
    if (related > 0) signalCandidateIds.add(item.id);
    const entityScore = Math.min(1, direct * 0.5 + related * 0.2);
    if (entityScore > 0) entityScores.set(item.id, entityScore);
    if (!charEnabled) continue;
    const similarity = cosineSparse(queryVector, charNgramVector(docText(item), { maxNgrams: 1200 }));
    if (!(similarity > 0)) continue;
    if (lexicalCandidateIds.has(item.id)) charScores.set(item.id, similarity);
    if (similarity < 0.12) continue;
    let low = 0, high = topChars.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (topChars[middle].score > similarity) low = middle + 1; else high = middle;
    }
    if (low < charLimit) {
      topChars.splice(low, 0, { id: item.id, score: similarity });
      if (topChars.length > charLimit) topChars.pop();
    }
  }
  for (const entry of topChars) {
    charScores.set(entry.id, entry.score);
    signalCandidateIds.add(entry.id);
  }
  return { charScores, entityScores, matchedEntities: [...entityMatches], signalCandidateIds };
}

export function memoryTier(item = {}) {
  if (item.memoryTier === "core" || item.memoryTier === "archive") return item.memoryTier;
  const category = item.memoryCategory || item.type;
  return ["preference", "fact", "project_state"].includes(category) ? "core" : "archive";
}
