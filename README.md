# Runtime Self-Learning

Hanako runtime self-learning plugin. It observes local runtime signals, extracts repeatable experience, and feeds useful hints back into later conversations.

## What It Does

- Learns repeated workflows, common errors, usage pressure, and explicit user corrections.
- Searches learned experience through `self_learning_search`.
- Bridges Hanako official memory as read-only background memory.
- Generates improvement proposals when repeated runtime patterns suggest code or workflow changes.
- Sends pending proposal notifications into the current chat when Hanako exposes `session:send`.

## Install

```powershell
npm run check
npm test
npm run install-plugin
```

Then restart Hanako and enable `Runtime Self-Learning`.

## Tools

| Tool | Purpose |
| --- | --- |
| `self_learning_search` | Search learned patterns and optional official memory results. |
| `self_learning_activity` | Show recent learning activity. |
| `self_learning_stats` | Show counts, config, and pending proposals. |
| `self_learning_report` | Generate a compact learning report. |
| `self_learning_control` | Approve/reject patterns, update config, and handle proposals. |
| `self_learning_open_dir` | Open the local learning data directory. |

## Proposal Flow

Low-risk skill refreshes are auto-applied.

High-risk `code_patch` proposals are not auto-applied. When one is created, the plugin tries to post a chat notification with the proposal ID. The user can reply:

- `show proposal <ID>`
- `apply proposal <ID>`
- `reject proposal <ID>`

For `code_patch`, applying means a coding agent should inspect the proposal, edit files, run verification, and reinstall the plugin when appropriate.

## Official Memory

Hanako official memory is not exposed as a stable plugin API. This plugin uses a read-only file bridge:

- Official memory remains factual/background memory.
- Runtime self-learning remains procedural experience.
- Search keeps the two result types separate.

## Data

All plugin data is local:

```text
~/.hanako/self-learning/
```

Important files:

- `patterns.json`
- `activity_log.jsonl`
- `experience_log.jsonl`
- `error_log.jsonl`
- `proposals/*.json`
- `skills/self-learning/SKILL.md`

## Key Config

| Key | Default | Meaning |
| --- | --- | --- |
| `autoInjectHighConfidence` | `true` | Inject high-confidence hints. |
| `autoApproveHighConfidence` | `true` | Auto-approve strong repeated patterns. |
| `learnFromUsage` | `true` | Learn from usage metadata. |
| `officialMemoryBridgeEnabled` | `true` | Include read-only official memory in search. |
| `proposalChatNotificationsEnabled` | `true` | Notify the chat when high-risk proposals are created. |
| `modelAdvisorEnabled` | `true` | Let the small-model advisor refine patterns. |

## Verify

```powershell
npm run check
npm test
```

Current test suite covers scoring, injection decisions, proposal safety, and official-memory bridging.

## Uninstall

Delete:

```text
~/.hanako/plugins/hanako-runtime-learner/
```

Optional data cleanup:

```text
~/.hanako/self-learning/
```

License: MIT
