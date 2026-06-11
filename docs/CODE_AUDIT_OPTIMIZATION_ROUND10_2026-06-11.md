# Code Audit / Optimization Round 10

Date: 2026-06-11
Version: 4.0.21-lts
Guidance: `Hanako-runtime-learner_终局版详细路线图_v4.0_LTS.md`

## Audit conclusion

Round 10 addressed the largest remaining maintainability hotspot: `lib/common.js`. The goal was facade-style decomposition: keep every existing import from `./common.js` working while moving implementation into focused modules.

This avoids a high-risk cross-repo import rewrite and preserves the public utility surface.

## Code changes

### 1. `common.js` converted to a stable facade

Before this round, `common.js` contained configuration defaults, path helpers, JSON/JSONL IO, scoring/decay, injection logic, active skill registry loading, and SKILL.md rendering.

After this round:

```text
lib/common.js: 846 bytes
```

It now only re-exports from focused modules:

```text
lib/config-defaults.js
lib/json-io.js
lib/scoring.js
lib/skill-renderer.js
```

### 2. Extracted config defaults

New file:

```text
lib/config-defaults.js
```

Contains:

```js
DEFAULT_CONFIG
```

No behavior change. `common.js` still exports `DEFAULT_CONFIG`, so existing imports remain valid.

### 3. Extracted JSON/path IO helpers

New file:

```text
lib/json-io.js
```

Contains:

```text
hanakoHome
hanakoPreferencesPath
readHanakoPreferences
describeOfficialUtilityModel
learnerDir
safeFileSlug
readJson
writeJson
cleanupTempFiles
loadLearnerConfig
countJsonl
readRecentJsonl
countValues
countBy
```

This isolates filesystem/path/config-loading helpers from scoring and rendering logic.

### 4. Extracted scoring and injection logic

New file:

```text
lib/scoring.js
```

Contains:

```text
estimateTokensRaw
estimateTokens
ageDays
knowledgeTier
decayedScore
memoryStrength
patternStatus
isInjectable
decoratePatterns
```

This keeps CJK token estimation, forgetting curves, tiering, and injection eligibility together.

### 5. Extracted SKILL.md rendering and active-skill selection

New file:

```text
lib/skill-renderer.js
```

Contains:

```text
loadActiveSkillRegistry
isActiveSkillInjectable
selectInjectableActiveSkills
buildSkillMdFromPatterns
```

The rendering behavior and budget trimming logic were preserved.

### 6. Fixed credentials path freezing exposed by full tests

During full test, `credentials.js` exposed a pre-existing design issue: `CREDENTIALS_FILE` was bound at module import time, which could freeze the real user home before tests changed `HANA_HOME`.

Changed:

```text
lib/credentials.js
```

From import-time constant:

```js
const CREDENTIALS_FILE = path.join(learnerDir(), "credentials.enc")
```

To runtime resolver:

```js
function credentialsFile() {
  return path.join(learnerDir(), "credentials.enc");
}
```

Also isolated `tests/credentials.test.js` under a temp `HANA_HOME`, so tests no longer touch the real user data directory.

## Size result

```text
common.js             846 bytes
config-defaults.js   4186 bytes
json-io.js           3901 bytes
scoring.js           4344 bytes
skill-renderer.js    7808 bytes
```

The large mixed utility module is now a compatibility facade.

## Validation performed

Targeted:

```text
node --test tests/common.test.js tests/config-consistency.test.js tests/runtime-e2e.test.js tests/model-advisor.test.js tests/policy-audit.test.js tests/official-utility-model.test.js tests/skill-lifecycle.test.js
node --test tests/credentials.test.js tests/common.test.js tests/config-consistency.test.js tests/runtime-e2e.test.js
```

Project-level:

```text
npm run check
npm test
```

Results:

```text
npm run check: exit 0
npm test: 493/493 passing
```

## Remaining work

### P3 maintainability

1. `proposals.js` remains the next large governance lifecycle module to split.
   Recommended future split:
   - `proposal-core.js`
   - `proposal-diff.js`
   - `proposal-lifecycle.js`
2. `audit-dashboard.js` and `tools/report.js` still mix payload assembly and Markdown rendering.
3. Some callers can later migrate from `common.js` to focused modules directly, but this is optional because the facade preserves compatibility.

### P3 performance

1. `action-runtime.js` feedback reads still need an index or per-action retention strategy.
2. `skill-reflexion-cluster.js` still reads full reflexion history by design.
3. Proposal listing / doctor scans still use directory-wide reads and sorts.

## Risk assessment

- Public imports from `common.js` remain valid.
- No governance gate was changed.
- No config defaults changed.
- Credential storage now resolves the data path at runtime, which improves test isolation and environment correctness.
- Full test suite passes.
