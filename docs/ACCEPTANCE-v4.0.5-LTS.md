# Acceptance Report · v4.0.5 LTS

## Version information

Before:

```text
package version: 4.0.4-lts
npm test: 439 passed
npm run check: passed
```

After:

```text
package version: 4.0.5-lts
npm test: 448 passed
npm run check: passed
npm pack --dry-run: passed
```

## Goal

Add a conservative Cross-project Memory Transfer baseline without weakening policy gates or allowing transferred memory to mutate `SKILL.md` directly.

## New capabilities

- Generate source/target project profiles from package metadata and file lists.
- Compare project similarity across language, framework, and validation commands.
- Convert memory or skill candidates into reduced-confidence `transferred_candidate` objects.
- Require target-project validation commands before any transferred candidate can be admitted automatically.
- Force manual confirmation for source-project-specific memory, high-risk memory, missing validation, and low confidence.
- Reject transferred rules that attempt to bypass policy, scope, verifier, validation, rollback, sandbox, secrets, or credentials.

## New files

```text
lib/project-profile.js
lib/memory-transfer.js
lib/cross-project-scope.js
tests/cross-project-transfer.test.js
docs/ACCEPTANCE-v4.0.5-LTS.md
```

## Modified files

```text
package.json
package-lock.json
manifest.json
CHANGELOG.md
docs/DESIGN_GOAL_COMPLETION_MATRIX.md
```

## Added tests

```text
project profile generation
profile comparison
reduced-confidence transfer candidate creation
manual confirmation for project-specific memory
rejection of safety-weakening transferred memory
manual confirmation when target validation commands are missing
batch transfer validation summary
auto-promotion prohibition across transferred candidates
validation command derivation
```

## Safety boundary

Transferred memory is intentionally weaker than native memory:

```text
transferred memory → transferred_candidate → target validation → evidence update → possible future promotion
```

It cannot take the shortcut:

```text
transferred memory → active SKILL.md rule
```

## Automatic execution boundary

The version does not expand automatic high-risk execution. R3/R4 transferred candidates require manual confirmation. Safety-weakening text is rejected.

## Rollback and verification

This version introduces transfer candidates and validation requirements, not filesystem mutations. Therefore rollback is not applicable at transfer-creation time. Target-project verification is mandatory before promotion or use as an active skill.

## Known limitations

- No persistent transfer registry yet.
- No Agent Controller node for cross-project transfer yet.
- No benchmark corpus specifically for transfer quality yet.
- Semantic project similarity is still rule-based, not embedding-based.

## Next version recommendation

Implement Action Registry / Marketplace as a plugin-loading baseline while preserving core safety policy precedence.
