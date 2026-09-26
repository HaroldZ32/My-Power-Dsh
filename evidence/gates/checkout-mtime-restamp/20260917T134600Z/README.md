# Correction index — the 13:42:47 CHECKOUT RESTAMP (an mtime is not a revision identity)

- **Author**: docs-gate-engineer · **filed**: 2026-09-17T13:46Z · **lane**: gates / QA-suite evidence
- **Cause, one line**: the captain's wave commit `684dd3f` + merge `20a635e` **checked the tree out at
  13:42:47 (+0800)**, which rewrote the mtime of **4,289 tracked files** while every byte stayed identical.
- **Why this file exists**: several of my lane's accepted evidence records corroborate their conclusions with
  an mtime reading. Those readings were true when taken and are superseded now. This index states which claims
  survive (content identity) and which are superseded (times), so no reader re-derives drift from a clock.
- **Shape**: ONE index for ONE event, rather than a nested correction per record — the affected records are not
  being amended (their conclusions do not rest on the times), they are being *indexed*.

## 1. The measured event

```
$ date -Is
2026-09-17T13:43:33+08:00
$ git log --oneline -2
20a635e merge: wave 1 of the P1 friction register (fix/todo-register-p1) into dev
684dd3f fix(friction): close the P1 register — watchdog redesign, agent-teams deltas, QA baseline, docs/gate wiring, packaging closure
$ git diff --name-only 684dd3f^..684dd3f | wc -l
4299                                   # the wave commit's file set
$ git diff --stat 684dd3f..20a635e | tail -3
                                       # EMPTY — the merge added no bytes
$ find . -path ./.git -prune -o -type f -newermt '2026-09-17 13:42:40' ! -newermt '2026-09-17 13:42:55' -print | wc -l
4289                                   # files restamped in that 15 s window
$ stat -c '%y  %n' .mpd/mpd.jsonc
2026-09-16 14:35:34 +0800  .mpd/mpd.jsonc     # CONTROL: untracked ⇒ untouched by the checkout
```

The last two lines are the discriminator: the restamp covers the **tracked wave set** (4,289 of 4,299) and
leaves an *untracked* workspace file at its own time. This was a checkout, not a repo-wide `touch`, and not a
writer re-running.

### 1a. That count is PREDICATE- and MOMENT-dependent — three readings, all honest, none fixed

Raised by qa-lane-engineer, who counted **4,285** where I counted **4,289**. Their reading is right and so is
mine; the gap is two effects, and only the second one is the interesting one:

| reading | predicate (`.git` pruned, `-type f`, all) | moment | count |
|---|---|---|---|
| mine, as filed | `-newermt 13:42:40 ! -newermt 13:42:55` | 13:46:01 | **4,289** |
| theirs | `-newermt 13:42:46 ! -newermt 13:42:48` | ~13:47 | 4,285 |
| both, re-run together | the two predicates above | 13:47:33 | **4,285** / **4,284** |
| tightest | `-newermt 13:42:47 ! -newermt 13:42:48` | 13:47:47 | 4,279 |

1. **The bound difference is exactly ONE file, and it is identified.** `comm -13` between the two predicates
   returns a single member: `.mpd/scratch/merge2.log` at `13:42:48.221969848 +0800` — outside their
   `(13:42:46, 13:42:48]` bound, inside my `(13:42:40, 13:42:55]`. Their bound-difference hypothesis is
   therefore correct, and measured rather than merely plausible.
2. **The rest of the original 4-file gap is DRIFT, because the measured set is LIVE.** My own predicate returns
   4,289 at 13:46:01 and 4,285 at 13:47:33 — same command, different minute. Mechanism, measured: the wave commit
   carried **34** files from `evidence/wave1-integration/20260917T052400Z/**`; the captain is regenerating that
   directory right now (**9** rewritten since 13:46:40, **25** still carrying the window stamp, 10 shown modified
   by git). **Every rewrite moves one file OUT of the window**, so membership shrinks while the event stands still.

The stamp is one second wide with ~0.5 s of internal spread — per-10 ms clusters run 239, 188, 167, 165, 161, 158,
143, 141, 131, 123, 121, 119 … — which is why a ±1 s tolerance admits the whole event and **neither predicate
needs a winner**. Both seats established the same fact three ways; only the count moved.

**Amended class lesson:** a count needs its PREDICATE **and its MOMENT** — where the measured set is live, two
honest predicates measured minutes apart cannot agree, and a bare number is not a measurement. Where a reading
must be durable, use the **digest** (§3): the checkout did not move it and live writers do not move it.

*(§1a is an amendment to a file that no one has committed yet — this file is at `??` in git status — so it is
edited in place rather than nested; the field it corrects is the bare count in §1, which remains as measured at
13:46:01 and is now qualified by this subsection.)*

## 2. The readings in this lane that are now SUPERSEDED (measured list, not remembered)

Any `mtime` / `-newermt` reading in these files now reads a restamped clock value; read them as
*"as of its own filing, ≤ 13:42:47, before the wave checkout"*:

| file | what it pinned by time |
|---|---|
| `evidence/gates/build-form/20260917T033500Z-t60/{result.json,output.log}` | `AGENTS.md` mtime `11:27:12`; `EXTENSIONS-FOR-AGENTS.md` `09:33:52` |
| `evidence/gates/build-form/20260917T040500Z-t66/{result.json,output.log}` | dist mtimes unchanged by the two builds |
| `evidence/gates/build-form-review/20260917T031910Z/result.json` | three committed dists carry mtimes BEFORE t45's window |
| `evidence/gates/dist-fresh-crosscheck/20260917T033333Z/{result.json,output.log,twin-scan-packed-vs-checkout.log,UPDATE-20260917T035100Z-dist-drift-three-paths.txt}` | `dist_mtime` `10:54:37`, `src_mtime` `10:31:00`, packed/checkout mtimes, and the mid-run `find packages skills -newermt 11:44:01 → EMPTY` integrity line |
| `evidence/gates/dist-rebuild/20260917T021906Z/verify-gates-post-t44.log` | the T-43 guard's `02:31:00Z` src edit |
| `evidence/gates/cwd-hermetic/20260917T013500Z/{result.json,output.log}` | workspace `.mpd/mpd.jsonc` `2026-09-16 14:35` (still true — untracked) and the pre-existing edit's `09:12:55` |
| `evidence/gates/troubleshooting-t23-second-row/20260917T031123Z/{output.log,reconstructed-before.md}` | packed-copy and `outDir` mtimes |
| `evidence/gates/troubleshooting-t23-row/20260917T030350Z/reconstructed-before.md` | row text only (no clock claim) |
| `evidence/dsh-qa/suite-runner/handover-20260917T015029Z/result.json` | runner `f60ef2b5…` "on disk now, mtime 01:49:38Z" |
| `evidence/gates/agents-budget/20260917T011651Z/{crossref-audit.json,crossref-resolution.json}` | quoted MANUAL text containing the word |
| `evidence/gates/negative-controls/20260917T022119Z/seeded-dist.bak` | a `statSync(…).mtimeMs` sort inside a seeded copy |

NOT superseded — already corrected beside their own records, parent byte-untouched:
`evidence/dsh-qa/suite-runner/20260917T053605Z-t74-reason-ladder-verify/correction-20260917T134500Z-mtime-and-revision/`
(this seat) and `evidence/dsh-qa/suite-runner/2026-09-17T05-22-19Z-reason-label-defect/correction-2026-09-17T05-45-24Z-mtimes-refreshed-by-checkout.md`
(the repair's author, who found the same restamp in their `neutrality` block independently).

## 3. What SURVIVES — content identities, re-measured 13:46Z, unchanged by the checkout

```
a5ba27f66aec2b5549df0fcbe66f97f1f258054f3f3f2b400f3c49b3d32ce0aa  AGENTS.md                      48,641 B
5d935524b7db27ea47d3cda913a7f53541b3db2457e7097360f92cd59ee50f27  EXTENSIONS-FOR-AGENTS.md      15,660 B
6ca531d2b20afb19cdc336fa90fcbb7509d2237cfaea62adb2850325d6134992  VENDOR_LOCK.json               3,434 B
54585caba9a571324be85daeae09373622c173dcb660c7d409a0a2d987eebf9e  skills/dsh-qa/cases.json      14,542 B
5a1863b2755c6c9f034fe45f0790c59b80cb05a4a6036e1ab9f0b95f69d27b9d  packages/mpd-workmate-plugin/dist/index.js
7b821135d24a9bdd79b246f52adf346ab056d540bda7c3478490acf36aab8dc8  packages/mpd-team-watchdog-plugin/dist/index.js
```

Every one matches the value its own record filed, and `5a1863b2…` is the very hash
`dist-fresh-crosscheck` recorded on the **checkout** side of its packed-vs-checkout pairs — so the drift it
reported is still the drift on disk. `node scripts/verify-vendor.mjs` re-run at 13:43Z: **PASS, exit 0**
(`asset OK: skills 323 files`). **No conclusion in §2 changes; only the times do.**

## 4. The durable form, stated once

> **A hash of the bytes is a revision identity. An mtime is a moment-bound reading, and a checkout moves it
> without moving a byte. A gate's own output outranks an ad-hoc recomputation of that gate's digest.**

Corollary for reviewers: a `find … -newermt` line that once printed EMPTY will print file names after any
checkout of the same tree. That is the checkout, not a reopened writer window — the `skills/**` single-writer
window stayed closed through this event.
