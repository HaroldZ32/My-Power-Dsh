# T6 — repair of T5 findings: truthful CHANGELOG v0.15.5 entry + policy-worded `connection` rationale

UTC stamp: 2026-10-25T15:59Z. Branch `release/v0.15.5` (uncommitted wave tree). Sole writer for T6.

## A) `CHANGELOG.md` — the v0.15.5 entry (and nothing else)

Two edits inside the existing `## v0.15.5` section; the v0.15.4 entry and every older section are
byte-untouched (`git diff CHANGELOG.md` in `04-final-bytes.log` — the whole v0.15.5 block shows as added
because that entry is itself new in this uncommitted wave).

1. The summary claim is softened to what the tree supports:
   - before: `A pin-and-documents wave: **no plugin source changed**.`
   - after:  `A pin-and-documents wave: **no plugin behaviour changed**.`
   (One plugin SOURCE file *did* change — the two comment-only edits below — but no behaviour did,
   which the dist gate proves.)
2. A new closing bullet, in the file's existing `**Fixed — <scope>.**` shape:

> **Fixed — stale prose the pin bump invalidated.** A comment-only pass over the claim sites this wave
> falsified, so a reader is never told a version this release does not pin: the docblock above
> `PANEL_CSV_HOST_OWNED_SINCE` in `packages/mpd-tui-adapter-plugin` now separates the two facts it had
> merged — 0.16.1 is the release that INTRODUCED host ownership (a permanent gate floor, so the constant
> never moves), while the ADMITTED host is declared in `dsh-plugin.json` `compat.hosts` (0.17.0 since this
> release); `packages/mpd-tui-plugin/README.md` + zh-CN move their "adapted to" target to `0.17.0`; and
> `packages/mpd-better-sidebar-host/README.md` + zh-CN move their current-pin literal to `0.2.1-rc.3`. The
> module header of `packages/mpd-better-sidebar-host/src/index.ts` stops naming a pin literal in its
> `connection` rationale and states the policy instead — the row mounts wherever the host's peer floor
> (`0.2.1-rc.1+`) and this bundle's own pin both admit the installed harness — so a later bump cannot make
> it false. No constant, fixture, test, exported symbol or behaviour moved, and
> `node scripts/verify-dist-fresh.ts` proves the comment-only edits leave every committed `packages/*/dist`
> byte-identical to a fresh build (33/33 targets fresh, each rebuilt twice).

Every clause above was read off the tree in this session, not copied from the writers' claims.

## B) `packages/mpd-better-sidebar-host/src/index.ts` — module header, `connection` rationale

Comment-only, four lines → six lines; no code, no string, no exported symbol, no constant. Exact final
bytes (lines 35-40):

```
// `connection` is a cordis Service provided by `@deepseek-ai/dsh-client-connection`, i.e. by any harness
// at or past the host's peer floor (0.2.1-rc.1+). So the shim restates `connection` in its inject list
// and mounts the host as soon as that service exists — in every composition whose installed harness
// satisfies the host's peer floor and the pin this bundle declares alike. No version literal is named
// here on purpose: the shipped pin moves with each host bump, and only this policy stays true. The only
// self-disable left is the honest "this composition provides no connection service" one.
```

The predecessor named `this bundle's pinned 0.2.1-rc.2`; the replacement names the POLICY plus the
host's own floor (`0.2.1-rc.1+`, a range the host declares), so a future pin bump cannot falsify it.

Residual `0.2.1-rc.2` in the same header — **NOT touched, judgement reported**:
`THE SEAM MOVED TWICE … 0.2.1-rc.2 provides no webRuntime at all` is part of a measured, release-indexed
seam history (it also names `0.2.0-rc.2` beside it); it states what that release's seam shape was, not
which host this bundle pins. If the captain wants it generalized too ("0.2.1-rc.2 and later"), that is a
separate one-line decision — it is not the stale current-pin class T5 flagged.

## Gates — commands and OBSERVED results (run on the FINAL bytes, after a blank-line fix)

| Command | Exit | Observed |
|---|---|---|
| `node scripts/verify-dist-fresh.ts` | 0 | `ok: 33/33 targets fresh (each rebuilt twice, byte-identical)`; `FRESH packages/mpd-better-sidebar-host/dist/index.js` — so the comment edit did NOT move one dist byte (toolchain strips comments), proven by the gate rather than assumed. `mpd-better-sidebar-host/dist/index.js` md5 `185c806f4b300fb879c09e721eab91f9` is unchanged by this task. |
| `bun run verify:docs` | 0 | `pairs=50 failed=0 violations=0 exempt=24 derived=3 links=453 dead=0 — PASS` |
| `bun run verify:comments` | 0 | `VERDICT: PASS — every declaration in the family carries a precise comment and a full signature` |

Logs: `01-dist-fresh.log`, `02-docs.log`, `03-comments.log`, `04-final-bytes.log` (first diff capture),
`05-final-bytes.log` (settled hashes at 2026-10-25T15:59:47Z).

Final hashes: `CHANGELOG.md` `4621c11e79633fb199382a6650e59ac1` ·
`packages/mpd-better-sidebar-host/src/index.ts` `e38bceb7e49f4f05dd2d34c049c41547` ·
`.../dist/index.js` `185c806f4b300fb879c09e721eab91f9` (unchanged).

## Scope and bounds

- Touched exactly two files: `CHANGELOG.md` and `packages/mpd-better-sidebar-host/src/index.ts`
  (`git status --porcelain CHANGELOG.md packages/mpd-better-sidebar-host` also lists that package's two
  READMEs, which are T4's landed edits, not mine).
- NOT touched: `VENDOR_LOCK.json`, `dist/mpd-package/**`, `.mpd/**`, `evidence/**` history, package
  versions, any other plugin's source, any test or gate.
- Only the three gates above were run. `bun test`, `typecheck`, `verify:rows`, `verify:manifest`,
  `verify-vendor`, `verify-no-host-override` and the Docker lanes were NOT run for T6 — a comment plus
  release prose cannot be observed by them beyond what `verify-dist-fresh` already proves.
- `dist/mpd-package/**` still carries the pre-fix packed copies (stale by design until the captain
  re-packs).
