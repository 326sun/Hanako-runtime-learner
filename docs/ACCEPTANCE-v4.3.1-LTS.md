# Acceptance Report: v4.3.1 LTS

## Version information

Before:

```
package version: 4.3.0-lts
npm run check: passed
npm test: 496 passed
npm run benchmark: passed, 17 scenarios
npm run release:check: Score 100
```

After:

```
package version: 4.3.1-lts
npm run check: passed
npm test: 496 passed
npm run benchmark: passed, 17 scenarios
npm run release:check: Score 100
```

## This version's target

v4.3 LTS 维护期补丁。修复设置面板、语义搜索凭证解密与沙箱内 fetch 三个运行时缺陷，不改变任何自动化或安全边界。

## Changes

1. **Fix: settings panel auto-close**. Removed the cosmetic `dataDirPath` runtime display field and its `ctx.config.update()` call in `onload`. The config update was triggering a settings-panel re-render that dismissed the panel before changes could be saved.

2. **Fix: semantic search credential merge**. `tools/search.js` now calls `mergeCredentials()` after reading `config.json`, so the encrypted `semanticEmbeddingApiKey` is decrypted before the embedding API call. Previously the search tool read the raw config (only a placeholder after credentials migration), silently degrading semantic search to BM25-only.

3. **Fix: semantic search fetch in sandbox**. `tools/search.js` now uses Node.js native `https` for embedding API calls instead of relying on a global `fetch`. Hana's plugin sandbox may not expose `fetch`, which caused `embedTexts` to return `{ok:false, reason:"no fetch"}` and silently fall back to BM25-only retrieval.

## Safety boundary

No changes to automation, execution, or security boundaries. This is a bug-fix-only release.

```
R4: still never auto-executed
external side effects: still never auto-executed
push/tag/release/publish: still not auto-executed
patch writes: still require scope gate + transaction + verification
repair: still one-shot and verification-gated
project scripts: still require explicit hash approval
```

## LTS commitment

v4.3.1 is a maintenance patch on the v4.x LTS line. The LTS maintenance policy is unchanged:

- Bug fixes and security patches: accepted
- New automation boundaries: rejected
- Documentation and test improvements: accepted
- Architecture changes: require explicit acceptance report
