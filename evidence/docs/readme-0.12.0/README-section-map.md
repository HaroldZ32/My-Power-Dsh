# README section map — where each of the 21 pre-wave sections went

Wave: `readme-0.12.0`. Frozen contract: [`.mpd/plans/readme-0.12.0.md`](../../../.mpd/plans/readme-0.12.0.md) AC-1.

## Why this file exists

The wave replaced a 68 524 B `README.md` with a ~17 KB product page. AC-1 forbids LOSING a section.
It originally forbade that by requiring the old body be preserved verbatim at `docs/manual.md`; that
clause was **amended before verification** (AC-1 carries the amendment and its reason), because
`docs/user-guide.md` + `docs/user-guide.zh-CN.md` already IS the long-form manual and a `manual.md`
would have been a third overlapping document.

So the rule the verifier checks is the one that actually matters: **no section is lost.** This file is
the per-section mapping that arm is judged against. It was produced from a read-only audit of
`git show HEAD:README.md` (the pre-wave object) and is reproducible from that object plus
`.mpd/readme-ref/README.before.md` (byte-equal snapshot).

## The mapping

`HOME` names the document that carries the section's substance after this wave. A section marked
**RETAINED** is carried by the new `README.md` itself.

| # | Pre-wave `##` section | Verdict | Home |
|---|---|---|---|
| 1 | Table of contents | REDUNDANT | RETAINED (the product page's own navigation; GitHub also renders an outline) |
| 2 | Features | REDUNDANT (content) | RETAINED as the product page's `## Features`; each row's how-to is `docs/user-guide.md` §2–§10 and §13 |
| 3 | Requirements | **PARTIAL** | RETAINED — the product page's `## Install` names Node ≥ 22.18, `pnpm`, the `web`/`headless` profile and the no-credentials rule; the harness version is in `## Status and known limitations` |
| 4 | Installation | **PARTIAL** | RETAINED (the one command + uninstall + the checkout form) + `docs/user-guide.md` §1 for the long form; the "What the install mounts" row inventory belongs to `docs/design.md` §4, which this wave repairs |
| 5 | Quick start | **PARTIAL (near-unique form)** | RETAINED — the six-step first-run path is reproduced in the product page's `## Quick start`; no other document had it |
| 6 | Project rules and the main agent | REDUNDANT | `docs/user-guide.md` §2 |
| 7 | Commands | **PARTIAL** | `docs/user-guide.md` §12 (which is also more current — it states the explicit negatives and the current `/mpd` action list) |
| 8 | Usage | **PARTIAL** | RETAINED as the product page's `## Usage` table; the MCP literal-call recipes were **UNIQUE repo-wide** and this wave adds them to `docs/user-guide.md` as §13.11 |
| 9 | Specialists: the roster | **PARTIAL** | RETAINED as a `## Features` bullet + `docs/user-guide.md` §4, which this wave extends with the sizing-routing paragraph |
| 10 | Team mode | **PARTIAL** | RETAINED as the `Web \| TUI` rows + `docs/user-guide.md` §6 (whose plan-approval claim this wave repairs — the guide contradicted the shipped gate) |
| 11 | Web GUI | REDUNDANT | `docs/user-guide.md` §8 |
| 12 | The DSH-TUI edition | REDUNDANT | `docs/user-guide.md` §7 (+ 7.1–7.3), `docs/tui.md`, `docs/tui-parity.md` (now linked from the product page) |
| 13 | Configuration | **PARTIAL** | `docs/user-guide.md` §9 + §9.1; the product page keeps the layering rule and the restart caveat |
| 14 | Where your state lives | **PARTIAL** | The product page's `## Usage` states the two roots; `docs/design.md` §6 is the full table |
| 15 | Architecture | REDUNDANT | `docs/index.md` (same SVG + caption) and `docs/design.md` |
| 16 | FAQ | **PARTIAL** | `docs/user-guide.md` §11 for the symptom table (this wave adds the two rows that existed nowhere else), §9.1 for the restart answer, `docs/preset-default.md` for the preset answer; the product page states the credential, preset-default, data-location and fork answers in `## Install`, `## Usage` and `## Status and known limitations` |
| 17 | Documentation | REDUNDANT | RETAINED as a shorter `## Documentation`; `docs/index.md` is the full index |
| 18 | Contributing | REDUNDANT | RETAINED as a two-line `## Contributing`; `CONTRIBUTING.md` is authoritative |
| 19 | Changelog | REDUNDANT + was STALE | RETAINED as a pointer; the stale "current release is v0.11.1" is corrected to v0.12.0 |
| 20 | Acknowledgements | REDUNDANT | RETAINED as a condensed `## Acknowledgements`; `docs/user-guide.md` §14 and `LICENSE-NOTICES.md` are authoritative |
| 21 | License | REDUNDANT-but-keep | RETAINED — a product page must state it |

## Named exceptions

- **`docs/manual.md` was NOT created.** AC-1's amendment states why: `docs/user-guide.md` (57 770 B,
  plus its `zh-CN` twin) already is the long-form manual.
- **The three authored SVGs left the README** (`architecture.svg`, `ulw-loop.svg`,
  `team-lifecycle.svg`). They are not lost: they remain in `docs/assets/images/`, are still rendered
  by `docs/index.md`, and are linked from the product page's `## Documentation` through the documents
  that own them.
- **Nothing was dropped silently.** Every REDUNDANT verdict names the document that carries the
  substance; every PARTIAL verdict names where the missing half went.

## What this map does NOT claim

It does not claim the pre-wave README was correct. The audit that produced it found the OPPOSITE for
the sections it read closely: the old README carried a stale version badge (`0.11.1` against a
`0.11.6` tree), a stale `optionalDependencies` table, a stale install row count, and — most
seriously — the *user guide* it pointed at still described a plan-approval flow that no longer
existed. This wave repairs those; the per-item record is the repair writer's report, and the staleness
list is in the wave's pull-request description.
