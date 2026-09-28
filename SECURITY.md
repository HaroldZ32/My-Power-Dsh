# Security Policy

**English** | [中文](./SECURITY.zh-CN.md)

This repository is a DeepSeek Harness (DSH) plugin bundle: it adds plugin rows, one agent preset and
MCP servers to a DSH installation. It runs no service of its own, and it never configures, stores or
transmits model credentials — DSH owns those.

## Supported versions

Security fixes land on the newest release on `master` (`v0.11.1` at the time of writing). Older
releases are not maintained; install the newest tag before reporting.

## Reporting a vulnerability

**Do not open a public issue.** Use GitHub's private vulnerability reporting from the repository's
**Security** tab (**Security** → **Report a vulnerability**). If that entry is unavailable, open a
short issue stating only that you have a security report and ask for a private channel — do not put
the details in the issue.

Please include:

- the affected version or commit;
- the DSH profile, and how the bundle was installed (checkout or packed artifact);
- a minimal reproduction — the exact command, slash command or tool call;
- the impact you believe it has.

## Scope

- **In scope.** This repository's own code: the plugin packages under `packages/`, the two patch
  files, the `mpd` preset, the extension interface, the skills corpus and the repository scripts.
- **Out of scope — report upstream.** The harness packages this bundle mounts, the model providers,
  and the third-party tools it consumes (`@ast-grep/cli`, `@colbymchenry/codegraph`,
  `@code-yeongyu/comment-checker`, `dsh-better-sidebar`, and the adopted `agent-teams` body). The
  provenance and licence of each are recorded in [`LICENSE-NOTICES.md`](./LICENSE-NOTICES.md).
- **Never include credentials, tokens or private code** in a report, a patch or an evidence file.
