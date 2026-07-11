/**
 * credentials.js — at-rest encryption for sensitive config values.
 *
 * Sensitive keys (API keys, tokens) are stored encrypted in a separate file
 * (credentials.enc) rather than in plaintext in config.json. Encryption uses
 * AES-256-GCM with a key derived from machine identity (hostname + username).
 *
 * This is NOT cryptographically perfect — an attacker with filesystem access
 * can derive the same key. It protects against:
 *   - Accidental config.json sharing / copy-paste
 *   - Casual filesystem scanning
 *   - Log output that includes config dumps
 *
 * Keys stored here: modelAdvisorApiKey, semanticEmbeddingApiKey
 */

import crypto from "crypto";
import os from "os";
import fs from "fs";
import path from "path";
import { learnerDir } from "./common.js";
import { atomicWriteFileSync } from "./atomic-file.js";

function credentialsFile({ dataDir = null } = {}) {
  return path.join(dataDir || learnerDir(), "credentials.enc");
}
const SENSITIVE_KEYS = new Set(["modelAdvisorApiKey", "semanticEmbeddingApiKey"]);

// Placeholder written into config.json in place of a sensitive value once it has
// been moved to the encrypted store. Code paths that read config.json without
// calling mergeCredentials() see this string — it is NOT a usable secret and
// must never be sent to an endpoint as a real credential.
export const CREDENTIAL_PLACEHOLDER = "(stored in credentials.enc)";

// ── Key derivation ──────────────────────────────────────────────────────────

const SALT = Buffer.from("hanako-self-evolve-v4", "utf-8");
const KEY_LEN = 32;
const IV_LEN = 12;
const TAG_LEN = 16;
const ITERATIONS = 100_000;

// The key derives from constant per-process inputs (machine identity + fixed
// salt), so derive it once. PBKDF2 with 100k iterations costs tens of ms;
// loadCredentials decrypts every stored key and would otherwise pay that cost
// per entry on every call.
let _cachedKey = null;
function deriveKey() {
  if (_cachedKey) return _cachedKey;
  const seed = `${os.hostname()}:${os.userInfo().username}:hanako-runtime-learner`;
  _cachedKey = crypto.pbkdf2Sync(seed, SALT, ITERATIONS, KEY_LEN, "sha256");
  return _cachedKey;
}

// ── Encrypt / decrypt ───────────────────────────────────────────────────────

function encrypt(plaintext) {
  const key = deriveKey();
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf-8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

function decrypt(payload) {
  const key = deriveKey();
  const buf = Buffer.from(payload, "base64");
  if (buf.length < IV_LEN + TAG_LEN + 1) return null;
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const encrypted = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf-8");
  } catch {
    return null;
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Read all stored credentials. Returns {} when no credentials file exists or
 * decryption fails (e.g. hostname change).
 */
export function loadCredentials(options = {}) {
  try {
    const file = credentialsFile(options);
    if (!fs.existsSync(file)) return {};
    const raw = fs.readFileSync(file, "utf-8").trim();
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    const result = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value !== "string" || !value) continue;
      const decrypted = decrypt(value);
      if (decrypted !== null) result[key] = decrypted;
    }
    return result;
  } catch {
    return {};
  }
}

/**
 * Persist a set of sensitive key→value pairs. Only keys listed in SENSITIVE_KEYS
 * are stored; others are silently ignored. Pass an empty object to clear all
 * credentials.
 */
export function saveCredentials(entries = {}, options = {}) {
  const store = {};
  for (const [key, value] of Object.entries(entries)) {
    if (!SENSITIVE_KEYS.has(key)) continue;
    if (typeof value !== "string" || !value.trim()) continue;
    store[key] = encrypt(value.trim());
  }
  if (Object.keys(store).length === 0) {
    try { fs.rmSync(credentialsFile(options), { force: true }); } catch {}
    return;
  }
  atomicWriteFileSync(credentialsFile(options), JSON.stringify(store, null, 2), "utf-8");
}

/**
 * Merge credentials into a config object: any sensitive key present in the
 * credential store overrides the plaintext fallback in config. Used at startup
 * so the runtime always reads the canonical encrypted value.
 */
export function mergeCredentials(config = {}, options = {}) {
  const creds = loadCredentials(options);
  const result = { ...config };
  for (const key of SENSITIVE_KEYS) {
    if (typeof creds[key] === "string" && creds[key]) {
      result[key] = creds[key];
    }
  }
  return result;
}

function credentialsFromPatch(patch = {}) {
  const toEncrypt = {};
  for (const key of SENSITIVE_KEYS) {
    if (typeof patch[key] === "string" && patch[key].trim()) {
      toEncrypt[key] = patch[key].trim();
    }
  }
  return toEncrypt;
}

export function sanitizeCredentialPatch(patch = {}) {
  const sanitised = { ...patch };
  for (const key of SENSITIVE_KEYS) {
    if (key in sanitised) {
      sanitised[key] = CREDENTIAL_PLACEHOLDER;
    }
  }
  return sanitised;
}

/**
 * When saving config via control.js (set_config action), extract any sensitive
 * keys and persist them to the encrypted store instead of writing them to
 * config.json in plaintext. Returns the sanitised config (with sensitive keys
 * replaced by placeholders) that is safe to write to config.json.
 */
export function extractAndSaveCredentials(patch = {}, options = {}) {
  const toEncrypt = credentialsFromPatch(patch);
  if (Object.keys(toEncrypt).length > 0) {
    saveCredentials({ ...loadCredentials(options), ...toEncrypt }, options);
  }
  // Return a sanitised patch: sensitive keys replaced with a placeholder so
  // they never land in config.json plaintext.
  return sanitizeCredentialPatch(patch);
}

/**
 * Extract real credential values typed into the Hanako settings panel
 * (`ctx.config`). The panel→runtime bridge (applyPanelConfig) deliberately drops
 * credential keys so they never land in config.json plaintext, but a key the
 * user typed into the panel field should still take effect — so onload routes
 * whatever this returns into the encrypted store. Blank, placeholder, masked,
 * and non-sensitive values are ignored. Returns a (possibly empty) map of
 * { sensitiveKey: trimmedValue }.
 */
export function panelCredentialsToStore(panelConfig = null) {
  const out = {};
  if (!panelConfig || typeof panelConfig !== "object") return out;
  // v0.341+: ctx.config is a method-based store; credential keys live behind
  // getAll(), not as direct properties. Extract the value map first so panel
  // fields keep reaching the encrypted store on both old and new hosts.
  const values = typeof panelConfig.getAll === "function" ? (panelConfig.getAll() || {}) : panelConfig;
  for (const key of SENSITIVE_KEYS) {
    const val = values[key];
    if (typeof val !== "string") continue;
    const trimmed = val.trim();
    if (!trimmed || trimmed === CREDENTIAL_PLACEHOLDER || trimmed.startsWith("***")) continue;
    out[key] = trimmed;
  }
  return out;
}

/**
 * Check whether any sensitive key in the config object contains a plaintext
 * value (i.e. was loaded from an old config.json before migration). Returns
 * the keys that should be migrated.
 */
export function detectPlaintextCredentials(config = {}) {
  const plain = [];
  for (const key of SENSITIVE_KEYS) {
    const val = config[key];
    if (typeof val === "string" && val && val !== CREDENTIAL_PLACEHOLDER && !val.startsWith("***")) {
      plain.push(key);
    }
  }
  return plain;
}

export { SENSITIVE_KEYS };
