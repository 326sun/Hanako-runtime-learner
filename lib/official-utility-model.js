import fs from "fs";
import path from "path";
import { hanakoHome, readHanakoPreferences } from "./common.js";

function normalizeModelRef(raw) {
  if (!raw) return null;
  if (typeof raw === "object" && raw.id) {
    return {
      id: String(raw.id),
      provider: raw.provider ? String(raw.provider) : "",
    };
  }
  if (typeof raw !== "string") return null;
  const text = raw.trim();
  if (!text) return null;
  const idx = text.indexOf("/");
  if (idx === -1) return { id: text, provider: "" };
  return {
    provider: text.slice(0, idx),
    id: text.slice(idx + 1),
  };
}

const PROVIDER_KEY_RE = /^[A-Za-z0-9_.-]+$/;
const PROVIDER_FIELD_RE = /^[A-Za-z0-9_.-]+$/;
const CREDENTIAL_FIELDS = new Set(["api_key", "apiKey", "base_url", "baseUrl", "api"]);

function parseScalar(value) {
  const raw = String(value || "").trim();
  if (!raw || raw === "|" || raw === ">" || /^[&*]/.test(raw)) return { ok: false, value: "" };
  const quote = raw[0];
  if ((quote === "'" || quote === '"') && raw.at(-1) === quote) {
    return { ok: true, value: raw.slice(1, -1) };
  }
  if (quote === "'" || quote === '"') return { ok: false, value: "" };
  return { ok: true, value: raw };
}

function parseAddedModelProviders(text) {
  const lines = String(text || "").split(/\r?\n/);
  const providers = {};
  let inProviders = false;
  let providersIndent = -1;
  let current = null;
  let providerKeyIndent = -1;
  let seenProvidersBlock = false;

  for (const line of lines) {
    const trimmed = line.trimStart();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const indent = line.length - trimmed.length;

    if (!inProviders) {
      if (/^providers:\s*$/.test(trimmed)) {
        if (seenProvidersBlock) return { ok: false, providers: {}, error: "duplicate providers block" };
        inProviders = true;
        seenProvidersBlock = true;
        providersIndent = indent;
      }
      continue;
    }

    if (indent <= providersIndent && !trimmed.startsWith("-")) {
      inProviders = false;
      current = null;
      providerKeyIndent = -1;
      if (/^providers:\s*$/.test(trimmed)) return { ok: false, providers: {}, error: "duplicate providers block" };
      continue;
    }

    if (trimmed.startsWith("-")) {
      return { ok: false, providers: {}, error: "provider credentials must be a mapping, not a sequence" };
    }

    if (indent > providersIndent && indent <= providerKeyIndent && current) {
      current = null;
      providerKeyIndent = -1;
    }

    const providerMatch = trimmed.match(/^([A-Za-z0-9_.-]+):\s*$/);
    if (!current && providerMatch) {
      const providerKey = providerMatch[1];
      if (!PROVIDER_KEY_RE.test(providerKey)) return { ok: false, providers: {}, error: "invalid provider key" };
      current = providerKey;
      providerKeyIndent = indent;
      providers[current] = providers[current] || {};
      continue;
    }

    if (!current || indent <= providerKeyIndent) {
      return { ok: false, providers: {}, error: "invalid providers structure" };
    }

    const fieldMatch = trimmed.match(/^([A-Za-z0-9_.-]+):\s*(.*)$/);
    if (!fieldMatch) return { ok: false, providers: {}, error: "invalid provider field" };
    const [, key, rawValue] = fieldMatch;
    if (!PROVIDER_FIELD_RE.test(key)) return { ok: false, providers: {}, error: "invalid provider field" };
    if (!CREDENTIAL_FIELDS.has(key)) continue;
    const parsed = parseScalar(rawValue);
    if (!parsed.ok) return { ok: false, providers: {}, error: `unsupported scalar for provider field: ${key}` };
    providers[current][key] = parsed.value;
  }

  return { ok: true, providers };
}

function readProviderCredentials(home, providerId) {
  const file = path.join(home, "added-models.yaml");
  if (!providerId || !PROVIDER_KEY_RE.test(String(providerId)) || !fs.existsSync(file)) return null;
  const parsed = parseAddedModelProviders(fs.readFileSync(file, "utf-8"));
  if (!parsed.ok) return null;
  const raw = parsed.providers[providerId];
  if (!raw) return null;
  return {
    provider: providerId,
    apiKey: raw.api_key || raw.apiKey || "",
    baseUrl: raw.base_url || raw.baseUrl || "",
    api: raw.api || "",
  };
}

function isOpenAiCompatible(api) {
  const text = String(api || "").toLowerCase();
  return !text || text === "openai" || text.includes("openai-completions") || text.includes("chat-completions");
}

export function resolveOfficialUtilityAdvisorConfig() {
  const home = hanakoHome();
  const prefs = readHanakoPreferences();
  const utilityRef = normalizeModelRef(prefs.utility_model);
  if (!utilityRef?.id) {
    return { ok: false, reason: "official utility model is not configured" };
  }

  const overrideProvider = prefs.utility_api_provider || "";
  const provider = utilityRef.provider || overrideProvider;
  if (!provider) {
    return { ok: false, reason: "official utility model provider is missing" };
  }

  let creds = null;
  if (prefs.utility_api_base_url || prefs.utility_api_key) {
    if (overrideProvider && overrideProvider !== provider) {
      return { ok: false, reason: "official utility API provider does not match utility model" };
    }
    creds = {
      provider,
      apiKey: prefs.utility_api_key || "",
      baseUrl: prefs.utility_api_base_url || "",
      api: "openai-completions",
    };
  } else {
    creds = readProviderCredentials(home, provider);
  }

  if (!creds?.baseUrl || !creds?.apiKey) {
    return { ok: false, reason: "official utility credentials are incomplete" };
  }
  if (!isOpenAiCompatible(creds.api)) {
    return { ok: false, reason: `official utility API is not OpenAI-compatible: ${creds.api}` };
  }

  return {
    ok: true,
    config: {
      modelAdvisorBaseUrl: creds.baseUrl,
      modelAdvisorApiKey: creds.apiKey,
      modelAdvisorModel: utilityRef.id,
      modelAdvisorResolvedSource: "official",
      modelAdvisorResolvedProvider: provider,
    },
  };
}
