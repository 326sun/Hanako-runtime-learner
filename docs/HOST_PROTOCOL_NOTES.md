# Hanako Host Protocol Notes

These notes record compatibility decisions that are easy to regress when the
host plugin SDK evolves.

## Usage Access

`usage.read` remains a manifest `permissions` entry. It is not a
`capabilities` or `sensitiveCapabilities` entry in the current official host
path used by `createPluginBusProxy`.

The manifest contract test keeps this split explicit so future migrations do
not accidentally move usage access into an inert capability declaration.

## Session Files

User-visible generated artifacts should be handed to Hanako with
`ctx.stageFile()` when the host provides it and when a session target is
available (`sessionId`, `sessionRef`, or `sessionPath`).

The plugin still returns local artifact paths in tool JSON because older hosts
and command-line smoke tests may not provide `stageFile()`.

Current staged control outputs:

- `run_benchmarks`: `benchmark-report.md`, `benchmark-report.json`
- `export_audit_bundle`: `audit-report.md`, `audit-bundle.json`
- `generate_audit_dashboard`: `dashboard.md`, `dashboard.json`
- `release_readiness`: `release-readiness.md`, `release-readiness.json` when JSON output includes `outputDir`

## Network Fetch

`ctx.network.fetch` requires a declarative manifest `network.fetch` capability
and static host allowlist. Runtime Self-Learning intentionally lets the user
configure arbitrary OpenAI-compatible model and embedding endpoints, so those
hosts cannot be enumerated in manifest metadata.

For that reason the model advisor and semantic embedding path keep their direct
request implementation and remain gated by explicit user configuration,
validation, default-off switches, and credential handling. The manifest must not
declare unused `network.fetch` capability entries until Hanako supports a
dynamic user-approved endpoint flow for this use case.
