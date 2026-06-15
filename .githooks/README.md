# Git hooks

Versioned hooks for this repository. They are not active until you point git at
this directory (once per clone):

```sh
git config core.hooksPath .githooks
```

## pre-push

Runs the same checks as CI (`npm run release:check`, `npm run check`,
`npm test`) before every push, so a broken release — such as a half-finished
version rename where `package.json` and the release-readiness artifacts
disagree — fails locally instead of turning the remote CI red.

Bypass in an emergency: `git push --no-verify`.
