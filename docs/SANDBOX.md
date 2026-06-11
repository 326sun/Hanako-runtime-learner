# Sandbox API Freeze

Status: frozen for v4.0.17 LTS.

## Purpose

Sandboxing limits command and plugin execution. The current LTS baseline is a bounded process and command sandbox, not a full container or OS-level isolation layer.

## Current sandbox layers

| Layer | Status |
|---|---|
| Command allowlist / denylist | Implemented |
| Workspace filesystem boundary | Implemented |
| Transaction snapshots | Implemented for R2 writes |
| Plugin child-process isolation | Implemented |
| Timeout enforcement | Implemented |
| Sanitized plugin process environment | Implemented |
| stdout/stderr byte caps | Implemented |
| Container / OS user isolation | Not part of v4.0 LTS core |

## Command policy

Allowed commands must match the configured allowlist. Denied command fragments such as destructive shell operations, publishing, git push/tag, release commands, and network write commands are rejected.

```json
{
  "autoActionCommands": {
    "allowlist": ["node --check"],
    "denylist": ["rm", "del", "git push", "git tag", "npm publish", "release"],
    "allowProjectScripts": false
  }
}
```

## Plugin process contract

File-backed plugin modules run through a child Node process. The process receives structured input and returns a structured result envelope. It is bounded by:

1. Workspace `cwd`.
2. Sanitized `env`.
3. Timeout and forced termination.
4. stdout/stderr size caps.
5. Structured JSON result parsing.

## Explicit limitation

Child-process isolation is not equivalent to a container sandbox. A plugin that is explicitly allowed to execute remains trusted code within the local user environment. The LTS promise is that plugin code no longer shares the host runtime process and cannot bypass Hanako policy gates, not that it is untrusted malware isolation.

## Compatibility promise

v4.0.17 LTS freezes command policy semantics, plugin process result semantics, and workspace-bound execution. Future v4.x releases may add container adapters without removing the current process sandbox API.
