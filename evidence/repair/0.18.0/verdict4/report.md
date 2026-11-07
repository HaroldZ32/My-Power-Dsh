# Verdict 4 — narrow delta confirmation of `rec-20261107T095652-00f02e`

**Scope:** only the two open items of the third record (M2, PKG) plus its three nits. Head
`941b2640`; loop `loop-20261107T055457-25618b`. Live PR #103 body sha256
`79cd5b52e6783e0559a1ff7a1dac31e46fbf3ea3f51b81fa5585d87931e12770` (`updatedAt`
2026-11-07T10:01:04Z). Nothing in the reviewed tree was edited; the two `mpd_verify_evidence` gate
runs re-packed the gitignored `dist/mpd-package/` only.

## Assessment

Risk is LOW and the packaging item is genuinely closed: `package.json` `files` now carries
`specs/**`, the manifest gate packs 1257 files with 0 required paths absent, the real
`npm pack --dry-run` listing admits `specs/tui-hosts.json`, and `verify-pack-closure` is exit 0 with
668/668 bytes identical after the re-pack. Static gates is green on `941b2640` (Docker acceptance
also completed success on that sha). Item 1 is not closed as the record specified, so the delta
verdict is FAIL on that one item: the live PR body still asserts "Model selection runs through four
`agentOptions` sites" (EN) and "模型选择走四处 `agentOptions`" (ZH), while `docs/compatibility.md` §2
says "That is ONE site, not four"; the old overclaim ("this PR carries a run that shows which model
actually served the turn") is gone and the sentence now says one is proven / three are
declared unexercised bounds, but the record's expected rewrite asked for the one-proven site plus
the three **named** declared bounds and the four-site framing was not dropped.

## Ranked findings

1. **Medium — Item 1 (M2) remains open.** `docs/compatibility.md` §2 ("Model routing still works
   through `agentOptions` — at the one site this wave exercised… That is ONE site, not four")
   versus PR #103's live body §1: EN "Model selection runs through four `agentOptions` sites;
   **ONE is proven** — the consult spawn site… — and the other three share the seam but are
   declared UNEXERCISED bounds, not claims." and ZH "模型选择走四处 `agentOptions`，其中**只有一处
   被实证**——consult 生成站点…；另外三处共用同一接缝，但属于**已声明的未执行边界**，不作为结论。"
   The named bounds `TeamExecutor.spawn` / `resolveRunRoute` / the roster provider's
   `applyRoute` appear nowhere in the body. Direction: in both language sections, drop the
   four-site framing and name the one proven CONSULT-spawn site plus those three declared bounds,
   per the record's `expected` and `docs/compatibility.md` §2. (Described, not applied.)

No other finding.

## Nits — confirmed consistent

- Release `evidence/release/0.18.0/2026-11-07T06-55-08Z/result.json` `rows[1]` (verify-vendor) now
  points at `49-repin-check.log`, 392 files, treeSha `3133e6fb…`; the superseded 391 run is marked
  superseded in the same row. Consistent.
- `docs/compatibility.md` §3 and `docs/compatibility.zh-CN.md` §3 label 49 arms / 1 deviation /
  5 bounds as the **LOCAL** shipped-tree run (ambient 0.18.0) and state CI on the same commit
  installs 0.19.0 and reports 48 arms / 1 deviation / 6 bounds. Consistent.
- PR body row summary now reads "every row PASSES except the one intermediate oneclick run,
  retained on purpose…"; ZH "除 oneclick 中间那次运行外，所有行均 PASS". Matches `result.json`
  rows 19 (exit 1, retained) and 20 (exit 0, re-run). Consistent.

## CI on `941b2640`

`gh api …/check-runs` on the head sha: **Static gates success** (1m36s), **Docker real-machine
acceptance success** (completed 10:06:27Z), CodeRabbit skipped. Read via read-only `gh api`.

## Declined to judge

- Credentialed Docker `--live` / browser rows — not run here; the CI Docker acceptance job is
  green, and no credentialed lane was dispatched.
- The release `result.json` `verify-plugin-manifest` row still prints 1256 — it is the historical
  release-sweep transcript (pre-fix) and is truthful for its timestamp; the head gate prints 1257.
- Two docs whose sources post-dated the local pack stamp before my runs — the gate classifies them
  as expected-after-pack; after the pack-gate re-pack the closure is 668/668, 0 drift.
- Whether exactly four `agentOptions` call sites exist — not traced into source; the docs itself
  names four, and the defect judged here is the body's framing, not a code inventory count.
- `AGENTS.md` instruction-budget margin — untouched by this delta; the third record's N-AGENTS
  stays a standing note.
- CodeRabbit review rounds — bot skipped; outside this confirmation.

## Verdict

**FAIL** — Item 2 is closed and static gates is green on `941b2640`, but Item 1 (M2) is not closed:
the live PR body still carries the four-site `agentOptions` wording in both language sections and
does not name the three declared bounds as the record's expected text requires.

## Bounds

No device/Flutter, no credentialed Docker, no CI dispatch; no implementation source was read; the
packed artifact is gitignored and was re-packed locally by the `pack` gate; `npm pack` required
`npm_config_cache` under the workspace because the default `~/.npm` cache is read-only (EROFS).
