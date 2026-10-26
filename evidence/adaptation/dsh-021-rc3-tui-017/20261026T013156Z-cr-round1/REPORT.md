# T8 — CodeRabbit round 1: three repairs (table-cell provenance, §11.10 Docker bounds, manifest disclosure version)

UTC stamp: 2026-10-26T01:31Z. Branch `release/v0.15.5`. Sole writer for T8.

## FIX 1 — `CHANGELOG.md`, the `**Added — the README version-correspondence table.**` bullet

The old text claimed every one of the six cells was "read from its release tag … not inferred", which is
false for the 0.15.5 row (no `v0.15.5` tag exists yet). New final bytes:

> DSH-TUI row — six releases from 0.14.0 through 0.15.5. The five historical rows were read from their
> release tags (`git show v<release>:package.json`, `dsh-plugin.json`'s `compat`,
> `dsh-distribution.json`'s `host-tui`); the 0.15.5 row is read from THIS release's own files in the release
> commit, because its tag is cut at release and does not exist yet — not inferred either way. The section
> also says where the two pins live (`package.json` for the harness,
> `dsh-plugin.json` `compat.hosts` + `dsh-distribution.json` for the TUI) and that a newer host is not
> claimed until a release row names it.

Everything else in the bullet is intact; no older entry was touched (`git diff -U2 CHANGELOG.md` shows a
single hunk inside the v0.15.5 section — `03-final-bytes.log`).

## FIX 2 — `docs/tui.md` §11.10 + `docs/tui.zh-CN.md` §11.10, the "Honest bounds" paragraph

Both said no live PTY capture was taken, which the wave's own Docker evidence contradicts. I re-read both
stamps myself before writing (see `stamp-facts.log`):

- `evidence/docker/client-install/2026-10-25T16-02-51Z/result.json` — `ok: true`, `summary.total 122`,
  `passed 77`, `failed 0`, `null 45`; all **22** `tui.*` assertions true, `tui.boot` raw
  `tmux=new-session-ok ready=chat-screen`, `tui.hostInstall` raw `version=0.17.0`, `tui.sessionPreset`
  raw `{"found":true,…,"agentPreset":"mpd",…}`, `boot.presetMount` true, `harness.version` true
  (`0.2.1-rc.3`). The 45 nulls are: 4 `oneclick.*` (mode=source), the credential-gated `live.*` rows +
  `boot.llmTurn` (`MPD_E2E_LIVE=0`, key absent), 9 `ui.*` (browser lane opt-in), `qa.mcpCall` (missing
  credentials).
- `evidence/docker/client-install/2026-10-25T16-13-29Z/result.json` — `ok: true`, `117 passed`, `0
  failed`, `5 null` (`oneclick.*` ×4 + `ui.teamBoard` "teamExpected=false"), with
  `live.web`/`live.tui`/`live.headless` `mpdToolCalled` **and** `assistantReplied` true, `boot.llmTurn`
  true, every `ui.*` row true except `ui.teamBoard`.

English final paragraph (excerpt): "**Honest bounds.** Both Docker real-machine lanes RAN on this wave's
final tree in a bare `ubuntu:24.04` … `…/2026-10-25T16-02-51Z/result.json` — `ok: true`, 122 assertions,
77 passed, 0 failed, 45 null … carries all 22 `tui.*` assertions true: `tui.boot` reached the chat screen
on a real PTY, `tui.hostInstall` reported `version=0.17.0`, `tui.sessionPreset` reported `agentPreset=mpd`
… ONE bound stands: the **one-click lane against the published package was NOT run** in this wave, so its
rows stay null — what these stamps measured is the checkout install, never the packed artifact."

中文 twin says the same in one paragraph (stamps cited by the same paths, same counts, same single bound;
the four/four `oneclick.*` nulls, the credential-gated `live.*`, the 9 opt-in `ui.*`, `qa.mcpCall`, and
`ui.teamBoard` left null). Both stay one paragraph, so the heading tree and the docs parity rules hold.

NOT claimed: neither stamp is described as "complete" (both record `complete: false`), and no stamp was
invented or re-dated.

## FIX 3 — `dsh-plugin.json`, `x-mpd-tui-surfaces.note`

One literal inside the note string only: `bundle package (version 0.15.1)` → `(version 0.15.5)`. The
separate TUI package's `(version 0.1.0, …)` in the same sentence is untouched, as are `version` (0.15.5),
`manifestVersion` (0.15), `$schema`, `compat.hosts` and every other key — `git diff dsh-plugin.json` is
exactly one `-`/`+` line pair (`03-final-bytes.log`), and a `json.load` re-read confirms the file parses
with those fields unchanged.

## Gates — commands and OBSERVED results

| Command | Exit | Observed |
|---|---|---|
| `bun run verify:docs` | 0 | `pairs=50 failed=0 violations=0 exempt=24 derived=3 links=453 dead=0 — PASS` |
| `bun run verify:manifest` (`node scripts/verify-plugin-manifest.ts --pack`) | 0 | `ok evidence-excluded … ok packed-content: npm pack --dry-run lists 1044 file(s); 0 required path(s) absent` · `VERDICT: PASS — the install-time rules and the packaging contract hold.` |

Logs: `01-docs.log`, `02-manifest.log`, `03-final-bytes.log`, `stamp-facts.log`.

Final hashes @2026-10-26T01:32:01Z: `CHANGELOG.md` `3dce8cd790b547586c3ca89aae47c4ac` ·
`docs/tui.md` `64a4879b10d7e2350d4b06ace3dc6d51` · `docs/tui.zh-CN.md` `986fd9eb5c0f27e107481c7b9e3a0800` ·
`dsh-plugin.json` `32029930a3393d74e6befc53a1c6ab62`.

## Bounds

- Touched exactly four files, all inside T8's write scope: `CHANGELOG.md`, `docs/tui.md`,
  `docs/tui.zh-CN.md`, `dsh-plugin.json` (plus this evidence directory).
- NOT touched: `dist/mpd-package/**` (still the pre-fix packed copy for the captain's re-pack),
  `VENDOR_LOCK.json`, `.mpd/**`, `evidence/**` history, any source file, any package version, any test or
  gate.
- Only the two gates T8 named were run. `verify:rows`, `verify:comments`, `verify-dist-fresh`,
  `verify:vendor`, `typecheck`, `bun test` and the Docker lanes were NOT run for this task — the change is
  two prose paragraphs, one release-note bullet and one JSON string literal that `verify:manifest` covers.
- The §11.10 paragraph now cites the stamps; it does not re-derive the Docker runs, and it makes no claim
  about the packed artifact, which remains unmeasured in this wave.
