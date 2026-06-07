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

function parseScalar(value) {
  const raw = String(value || "").trim();
  return raw.replace(/^['"]|['"]$/g, "");
}

function readProviderCredentials(home, providerId) {
  const file = path.join(home, "added-models.yaml");
  if (!providerId || !fs.existsSync(file)) return null;
  const lines = fs.readFileSync(file, "utf-8").split(/\r?\n/);
  const providers = {};

  // Track indentation depth to handle nested YAML structure:
  // providers:
  //   deepseek:         <- 2-space indent: provider key
  //     base_url: ...    <- 4-space indent: provider field
  let inProviders = false;
  let current = null;
  let currentIndent = 0;

  for (const line of lines) {
    const trimmed = line.trimStart();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const indent = line.length - trimmed.length;

    // Enter providers block
    if (!inProviders && indent === 0 && trimmed.match(/^providers:\s*$/)) {
      inProviders = true;
      continue;
    }
    if (!inProviders) continue;

    // Exit providers block: any line at indent 0 that isn't a provider sub-field
    if (indent === 0 && !trimmed.startsWith("-")) {
      inProviders = false;
      continue;
    }

    // Provider key: 2-space indent, followed by colon
    if (indent === 2 && !trimmed.startsWith("-") && trimmed.match(/^[A-Za-z0-9_.-]+:\s*$/)) {
      current = trimmed.slice(0, -1).trim();
      currentIndent = indent;
      providers[current] = providers[current] || {};
      continue;
    }

    // Exit current provider if indent decreases
    if (current && indent <= currentIndent) {
      current = null;
      currentIndent = 0;
    }

    // Provider field: 4-space indent
    if (indent === 4 && current) {
      const fieldMatch = trimmed.match(/^([A-Za-z0-9_.-]+):\s*(.*)$/);
      if (fieldMatch) {
        const [, key, value] = fieldMatch;
        if (["api_key", "apiKey", "base_url", "baseUrl", "api"].includes(key)) {
          providers[current][key] = parseScalar(value);
        }
      }
    }
  }

  const raw = providers[providerId];
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
