# Code Audit / Optimization Round 8

Date: 2026-06-11
Version: 4.0.21-lts
Guidance: `Hanako-runtime-learner_终局版详细路线图_v4.0_LTS.md`

## Audit conclusion

This round continued after Round 7 and targeted the next safest optimization layer:

1. close the remaining P2 concern around hand-written `added-models.yaml` credential parsing;
2. remove duplicated project-script detection logic between command allowlisting and project-script trust;
3. reduce one JSONL full-read path without weakening event-log hash-chain verification.

Large `common.js` splitting and broader proposal/audit renderer decomposition remain deferred because they are larger P3 maintenance work and should be done behind a compatibility facade.

## Code changes

### 1. Hardened official utility YAML credential parsing

File:

```text
lib/official-utility-model.js
```

The old parser scanned `added-models.yaml` with loose indentation heuristics and accepted provider fields opportunistically. The new logic adds a small structural parser for the only supported credential shape:

```yaml
providers:
  provider-id:
    api_key: ...
    base_url: ...
    api: openai-completions
```

New safety behavior:

- provider IDs must match `[A-Za-z0-9_.-]+`;
- provider blocks must be mappings, not sequences;
- credential fields are limited to `api_key`, `apiKey`, `base_url`, `baseUrl`, and `api`;
- unsupported scalar forms such as block scalars (`|`, `>`) and YAML anchors/aliases (`&x`, `*x`) fail closed;
- malformed provider structures return no credentials rather than guessing;
- model sections are not treated as provider credentials.

The resolver still returns the existing high-level reason (`official utility credentials are incomplete`) so callers do not receive raw YAML fragments or sensitive details.

### 2. Unified project script detection

Files:

```text
lib/command-allowlist.js
lib/project-script-trust.js
```

`command-allowlist.js` no longer has its own private `isProjectScriptCommand()` regex. It now imports the shared parser from `project-script-trust.js`.

Effect:

- `npm test` and `npm run <script>` are identified consistently;
- normal allowlist entries cannot bypass the project-script trust gate;
- explicit `allowProjectScripts: true` still lets `isCommandAllowed()` pass, while `runSandboxedCommand()` continues to require package script hash trust.

This removes a policy fork noted in the audit.

### 3. Tail-read optimization for recent event reads

File:

```text
lib/event-log.js
```

`verifyEventLog()` intentionally remains a full scan because hash-chain verification must inspect every row.

Only `readEvents()` changed. It now reads a bounded tail window and expands up to 1 MiB if needed to collect enough recent lines:

```text
initialBytes: 64 KiB
maxBytes: 1 MiB
sampled lines: max(limit * 4, limit)
```

The public API remains reverse-chronological, as before.

Why this is safe:

- `readEvents()` was already a recent-events API;
- event replay still sorts by date and tail-local `seq` for same-millisecond ordering;
- full hash verification remains untouched.

## Tests added / updated

### `tests/official-utility-model.test.js`

New coverage:

- valid `added-models.yaml` provider credentials resolve successfully;
- block scalar credentials fail closed;
- `models:` entries are not mistaken for provider credentials;
- sequence-style providers are rejected instead of guessed.

### `tests/command-allowlist-final-audit.test.js`

Updated coverage:

- allowlisted `npm run build` is rejected without project-script permission;
- shared project-script parser allows `npm run build` only when project-script execution is explicitly enabled at the allowlist stage.

### `tests/event-log.test.js`

Updated coverage:

- `readEvents()` returns latest events in the existing reverse-chronological API order;
- type filtering still works over the sampled tail.

## Validation performed

Targeted:

```text
node --test tests/event-log.test.js tests/official-utility-model.test.js tests/command-allowlist-final-audit.test.js tests/command-allowlist.test.js tests/project-script-trust.test.js
```

Project-level:

```text
npm run check
npm test
```

Results:

```text
npm run check: exit 0
npm test: 491/491 passing
```

## Remaining work

### P3 code size / maintainability

1. `common.js` remains the largest multi-responsibility module. Recommended next move is facade-preserving extraction:
   - config defaults / config loading;
   - JSON/JSONL IO helpers;
   - scoring and decay functions;
   - skill rendering.
2. `safeFileSlug` and local slug helpers still have some duplication in skill candidate code.
3. `audit-dashboard.js` and `tools/report.js` can still separate payload construction from Markdown rendering.

### P3 performance

1. `common.readRecentJsonl()` still uses a full read.
2. `skill-reflexion-cluster.js` still reads full JSONL files.
3. `action-runtime.js` still reads all feedback rows before sorting.
4. `verifyEventLog()` remains full scan by design; do not tail-optimize it unless an indexed Merkle checkpoint scheme is introduced.

## Risk assessment

- No governance gate was loosened.
- Project-script detection is stricter and centralized.
- YAML credential parsing fails closed on unsupported structures.
- Event-log verification semantics are unchanged.
- Recent-event reads now have bounded IO.
- Full test suite passes.
