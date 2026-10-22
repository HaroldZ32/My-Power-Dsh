# mpd-project-init-plugin

**English** | [中文](./README.zh-CN.md)

One-time `AGENT.md` scaffold for a new project. On the first `agent/pre-step` of a
TOP-LEVEL session the row inspects the session's workspace and, only when that workspace is
a fresh project carrying no agent-instruction file, writes one generic English `AGENT.md`,
records `<workspace>/.mpd/project-init.json` and appends one line to
`<workspace>/.mpd/logs/mpd-project-init.log`. It never overwrites, and it writes nothing
outside the session workspace.

## Trigger

- One `agent/pre-step` listener per agent, registered in that agent's OWN scope through
  `mpd-dsh-adapter` (`registerAgentPreStep`) — the site delivery reliably reaches.
- The classification runs at STEP time, not at registration: TOP-LEVEL sessions only (a
  recorded `origin: "subagent"` or a `delegationDepth` of `1` or more is a child; a missing
  header fails closed; preset names are never read — see T-92).
- ONE inspection per agent handle; every later step of the same session is a no-op.

## Skips (all silent — nothing is written)

- The session workspace is HOME or a filesystem root.
- Any of `AGENT.md`, `AGENTS.md`, `CLAUDE.md` already exists (matched case-insensitively).
- `<workspace>/.mpd/project-init.json` already exists.
- The directory is not project-like: it has visible content but neither `.git` nor a project
  manifest. An empty or dotfiles-only directory (a fresh `git init`) IS project-like, because
  that is exactly the "new project" this row exists for.

## What is written

- `AGENT.md`: generic English operating instructions — session read-first rule, planning,
  small diffs, command placeholders, verification, branch + pull-request discipline,
  delegation + evidence, security. Every project-specific value is an obvious
  `<fill in: …>` placeholder; the scaffold never invents a command. The first line is a
  provenance comment naming this row and the creation instant.
- `.mpd/project-init.json`: the marker (`version`, `plugin`, `file`, `createdAt`) that keeps
  the write a one-time act. It never overwrites a file this row did not create.
- `.mpd/logs/mpd-project-init.log`: ONE line recording the creation.

## Bound

The harness loads agent instructions when a session STARTS, so an `AGENT.md` written during
this session's first pre-step is injected in the NEXT session. It is never retroactive.

## Config

| Key | Type | Default |
|---|---|---|
| `enabled` | boolean | `true` |

## Why it exists

A fresh repository has no operating instructions, so every later session re-derives the same
conventions from scratch. Writing the file ONCE — never overwriting, never guessing a
command — is the smallest durable fix, and the marker keeps it a one-time act.
