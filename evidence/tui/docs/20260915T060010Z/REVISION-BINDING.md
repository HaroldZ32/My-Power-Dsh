# Revision binding for docs/tui.md + docs/tui.zh-CN.md (t27)

This note exists so a reader (or a later task) is never sent to a superseded artifact. The docs cite
**one** delivered revision; the earlier digests are history and must never be cited as current.

## The delivered revision (what the docs bind to)

| Artifact | sha256 | Bytes |
|---|---|---|
| `dsh-plugin.json` (frozen manifest) | `84ed4a5d5aac3fb07949f0f62bb7e7afdfa1e96de2c19de02974381eeb1201c9` | — |
| `packages/mpd-tui-plugin/dist/index.js` (the manifest's entry) | `5dce2563fd0e3b20afede061297b9bfc9856593703974fac44f8642830b85e6f` | 98883 |

Manifest identity pair at this revision: `name` `@mpd-dsh/mpd`, `version` `0.9.1`, `id`
`com.mpd-dsh.mpd-tui`, `manifestVersion` `0.15`.

## The chain, in order (history — never "current")

| # | `dist/index.js` sha256 | What it was | Which evidence measured it |
|---|---|---|---|
| 1 | `695f68c4858745cc35544ac77dbdb87907d6991c62f9435661e1fc02264f77ac` | t4's first build | t4 `evidence/tui/plugin/20260915T054343Z/`; recorded by t5's ledger (`evidence/tui/composition/20260915T053445Z/ledger.json`) |
| 2 | `710d3eef5d0f451bff220da151f45c9ccccb5b264ecfc215ce61be8b667e9fc3` | rebuilt for the `/settings` on-screen disclosure (t21) | t21 `evidence/tui/plugin-followup/20260915T060032Z/` (`artifact.sha256`, `disclosure.json`) |
| 3 | `5dce2563fd0e3b20afede061297b9bfc9856593703974fac44f8642830b85e6f` | **delivered revision** (t23/t24 rebuild; the revision the lanes measured) | t8 `evidence/tui/live/20260915T063140Z/REVISION.json` + `REVISION-RESOLUTION.md`; t9 `evidence/tui/conformance/20260915T064521Z/result.json` (`manifestPin.entrySha256`) |

## Lane-to-revision binding

| Lane / evidence | Revision measured |
|---|---|
| t5 composition + ledger | manifest pre-t24, `dist` #1 (see the ledger's own `revision` block) |
| t21 `/settings` disclosure | `dist` #2 |
| t8 live lanes (mount + panels) | `dist` #3, `5dce2563…` |
| t9 conformance lanes (admission, distribution, spec suite, regression) | manifest `84ed4a5d…` + `dist` #3, `5dce2563…` |
| t27 docs (this binding) | same as t8/t9 |

## What a citation must look like

- Correct: the delivered revision + the lane evidence in §11 of `docs/tui.md` / `docs/tui.zh-CN.md`.
- Wrong: quoting `695f68c4…` or `710d3eef…` as "the current artifact" (that is what this note
  exists to prevent).
- The docs deliberately do not repeat the intermediate digest inline; this note carries the full
  chain so the prose cannot go stale when an artifact moves again.

For the delivery report (`t14`): carry this binding verbatim — the report must name the frozen
manifest digest `84ed4a5d…` and the entry digest `5dce2563…`, and must describe the earlier digits
as history.
