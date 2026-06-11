# Acceptance Report · v4.0.6 LTS

## Version information

Before:

1. package version: `4.0.5-lts`
2. npm test: `448 passed`
3. npm run check: passed

After:

1. package version: `4.0.6-lts`
2. npm test: `458 passed`
3. npm run check: passed

## Goal

Add the first guarded Action Registry / Marketplace baseline without weakening the existing safety architecture.

This version does not turn plugins into unrestricted executable code. It separates registration, validation, loading, and execution, and keeps file-backed plugin code behind an explicit execution flag.

## New capabilities

- Action definitions can be registered through `lib/action-registry.js`.
- Action packages can be loaded from `action.json` packages through `lib/action-loader.js`.
- Core action types cannot be overridden by plugins.
- Core action types cannot be unregistered.
- Plugin actions cannot request network permission or external side effects.
- Plugin actions cannot declare policy/scope/verifier/rollback/sandbox bypass flags.
- Declared plugin commands are checked with the command allowlist hardening layer.
- R2+ write-capable plugin actions must declare rollback.
- R3/R4 plugin actions are queued for manual confirmation instead of auto-execution.
- File-backed plugin code requires `allowPluginCodeExecution: true` in the execution context.

## New files

```text
lib/action-registry.js
lib/action-loader.js
tests/action-registry.test.js
docs/ACCEPTANCE-v4.0.6-LTS.md
```

## Modified files

```text
package.json
package-lock.json
manifest.json
CHANGELOG.md
docs/DESIGN_GOAL_COMPLETION_MATRIX.md
```

## Safety boundaries

This version keeps the existing LTS boundary:

```text
R4 never auto-executes.
External side effects are not granted to plugins.
Network access is not granted to plugins.
Core policy, scope, verifier, rollback, and sandbox gates cannot be bypassed by plugin metadata.
Write-capable plugins must be R2+ and must require rollback.
High-risk plugins require manual confirmation.
```

## Verification

Validated commands:

```bash
npm run check
npm test
npm pack --dry-run
```

Expected result:

```text
npm run check: passed
npm test: 458 passed, 0 failed
npm pack --dry-run: passed
```

## Known limitations

- The registry is functional but not yet fully wired into all Agent Controller and executor paths.
- There is no persistent marketplace index yet.
- File-backed plugin execution is intentionally gated and should remain disabled by default.
- Real action package fixtures are still minimal.

## Next recommendation

Prioritize Agent Controller resume tooling and persistent transfer/action registries before adding more marketplace surface area.
