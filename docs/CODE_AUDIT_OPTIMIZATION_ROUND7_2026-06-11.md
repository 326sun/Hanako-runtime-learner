# Code Audit / Optimization Round 7

Date: 2026-06-11
Version: 4.0.21-lts
Guidance: `Hanako-runtime-learner_终局版详细路线图_v4.0_LTS.md`

## Audit conclusion

This round focused on the remaining v4.1/v4.2 safety and consistency gaps rather than broad refactoring. The highest-value low-risk fixes were:

1. plugin child processes had timeout/output caps but no V8 heap cap;
2. `safeWriteFile` and several governance exports still used direct writes instead of the project-wide tmp+rename pattern;
3. model-advisor usage metadata was sent whenever the advisor ran, without an independent opt-in;
4. private non-local HTTP advisor endpoints had no visible warning;
5. audit bundles redacted API-key fields but did not structurally redact URL userinfo/path/query.

Large P3 decompositions such as splitting `common.js` or rewriting JSONL readers were intentionally deferred because they have broader API and regression risk.

## Code changes

### 1. Shared atomic write helper

Added `lib/atomic-file.js`:

```text
atomicWriteFileSync(file, content, encoding)
```

It writes to a same-directory temporary file and then renames it into place. On failure it removes the temp file.

Adopted by:

- `common.writeJson`
- `filesystem-boundary.safeWriteFile`
- `credentials.saveCredentials`
- `audit-bundle.exportAuditBundle`
- `skill-promotion-store` save paths

This removes duplicated atomic-write code and closes the route-map P2-1 gap for `safeWriteFile`.

### 2. Plugin process memory cap

`plugin-process-runner.js` now applies a bounded child-process heap limit:

```text
--max-old-space-size=128
```

Config path:

```text
context.pluginIsolation.maxOldSpaceSizeMb
context.config.pluginIsolation.maxOldSpaceSizeMb
```

Bounds:

```text
16 MB ≤ maxOldSpaceSizeMb ≤ 4096 MB
```

Timeout and output-size config parsing now also uses a small bounded-number helper. This closes the route-map P1-3 gap without changing the plugin execution API.

### 3. Independent usage export switch for model advisor

Added config:

```text
includeUsageInAdvisorPrompt: false
```

Behavior:

- `learnFromUsage` still controls local usage observation and local pattern learning.
- `includeUsageInAdvisorPrompt` separately controls whether usage summary is included in advisor prompts.
- Default is false across `DEFAULT_CONFIG`, `manifest.json`, policy profiles, control schema, and reports.
- Enabling it is treated as a high-risk config enable and blocked in conservative profile.

This closes route-map P2-5.

### 4. Non-local HTTP advisor warning

Added `advisorEndpointWarning(baseUrl)` in `model-advisor.js`.

It warns when a configured advisor endpoint uses plain HTTP and is not local:

```text
http://api.example.com  -> warning
http://localhost:11434  -> no warning
https://api.example.com -> no warning
```

The warning is recorded in the generated model advice object as `warning`. This closes route-map P2-3 while preserving backward compatibility.

### 5. Audit bundle URL redaction

`audit-bundle.redactConfig()` now also redacts URL-like config values. For URL/endpoint keys it preserves only origin:

```text
https://user:pass@api.example.com/v1/chat/completions?token=secret
→ https://api.example.com
```

API key / token / secret / password fields are still replaced with `[redacted]`.

This closes route-map P2-2 for audit bundle exports.

## Tests added / updated

- `filesystem-boundary.test.js`
  - verifies `safeWriteFile` preserves the original file when atomic rename fails and cleans temp files.
- `action-registry.test.js`
  - verifies isolated plugin child processes receive the default V8 heap cap.
- `model-advisor.test.js`
  - verifies non-local HTTP warnings.
  - verifies usage summaries are excluded unless `includeUsageInAdvisorPrompt` is explicitly true.
- `policy-audit.test.js`
  - verifies policy profiles keep usage export off.
  - verifies audit bundle URL redaction.
- `config-consistency.test.js`
  - passes after adding the new manifest default.

## Validation performed

```text
node --test tests/policy-audit.test.js tests/config-consistency.test.js tests/model-advisor.test.js tests/filesystem-boundary.test.js tests/action-registry.test.js tests/skill-lifecycle.test.js tests/audit-dashboard.test.js
npm run check
npm test
```

Results:

```text
npm run check: exit 0
npm test: 485/485 passing
```

## Remaining work

### P2 remaining

1. `official-utility-model.js` still uses a hand-written YAML credential parser. Best next step: add structural validation first, then consider `js-yaml` if dependency policy allows it.

### P3 remaining

1. `command-allowlist.js` and `project-script-trust.js` still contain partially duplicated project-script detection logic.
2. `common.js` remains oversized and should later be split into config, IO, scoring, and SKILL rendering modules while preserving the current public exports.
3. JSONL read paths still contain several full-file reads: `event-log.js`, `common.readRecentJsonl`, `skill-reflexion-cluster.js`, and `action-runtime.js`.
4. `audit-dashboard.js` / `tools/report.js` can later separate payload builders from renderers.

## Risk assessment

The changes are intentionally narrow and mostly additive:

- no public action API was removed;
- no governance gate was loosened;
- new external-data behavior is stricter by default;
- file writes are more crash-safe;
- plugin execution has a bounded heap by default;
- full test suite remains green.
