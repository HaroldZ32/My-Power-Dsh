# Independent cross-check — T30's `team-store.ts` doc-comment correction (CR1-nit)

**Row:** T31 (board). **Judged:** T30 (`se-consume`), a COMMENT-ONLY repair of the deferred-heal claim in the
`memberIdentityOf` doc block of `packages/mpd-team-core-plugin/src/team-store.ts`.
**Loop:** `loop-20261103T080819-5165ba`. **Independence:** I did not write T30. I was paired to this row as the
fallback verifier because the declared owner (`rev-consume`) was busy with T29.

**Relation to `REPORT.md` in this directory.** That file is `rev-consume`'s own formal record, written at the
same time as my checks. I produced every log below BEFORE reading it (my logs are stamped 16:22–16:25; the
write guard refused my first `REPORT.md` write because that file already existed, and only then did I read its
head) — so the verdict here was formed from my own measurements, and it happens to AGREE with theirs: **PASS,
risk none, comment-only.** Where this cross-check ADDS to that record is §3 (the dist-neutrality byte proof
and the pre-existing dist-staleness fact) and §2's scoped phrase proof with its disclosed unrelated hits.

## 1. Verdict: **PASS** — the comment states what the code does, and the change is comment-only.

## 2. The criteria, each with MY evidence

| criterion | verdict | evidence |
|---|---|---|
| the doc block states the current behaviour | **PASS** | the block now reads: "THE BOUND: a FORKED Lead's NEW id is recorded only when the churn heal runs, and the heal SKIPS any session this predicate names as a member — so a fork whose title names a seat is NEVER healed on that record: it stays identified as that seat (seat-blocked, fail-closed, borrowing no Lead ancestry) while its title keeps naming one. That is the T12 residual — a separate discriminator, not a fact this arm can decide." (`02-comment-only-proof.log`) |
| every claim in it is carried by the code | **PASS** | `08-substance.log`, by SYMBOL (T-55): **c1** `healLeadBinding` returns untouched on `ownLead \|\| delegated` and records only via `rememberLead(record, [sessionId])` past its gates; **c2** the next gate is `if (memberIdentityOf(record, sessionId, title, lineage).named) return record` — the skip the comment names; **c3** `leadAuthorityOf` narrows the ancestry spellings to the caller's OWN id when `identity.named` ("A roster-named caller borrows no ancestry") → no Lead ancestry, fail-closed; **c4** `memberIdentityOf` ARM 3 answers `named: true` for a title match, so c2 really fires on a title-named fork; **c5** a RECORDED Lead answers `{ named: false }` before ARM 3, so captaincy is never replaced by a title. |
| no "until then / still read as that seat" claim remains | **PASS** | `09-phrase-grep-scoped.log`: in `team-store.ts` — `not recorded until its heal` **0**, `until its heal writes` **0**, `still read as that seat` **0**, `still read as that` **0**; the corrected phrases (`NEVER healed on that`, `the heal SKIPS any`) appear **once** each. **Disclosed, not hidden:** a repo-wide `until then` sweep still finds THREE hits in OTHER packages (`mpd-bundle-plugin/src/settings-card.ts`, `mpd-tui-adapter-plugin/src/index.ts`, `mpd-tui-plugin/src/dashboard-key.ts`) — different sentences about different subjects, none of them this claim (`04-phrase-grep.log` keeps the broad sweep for inspection). |
| the change is COMMENT-ONLY | **PASS** | `02-comment-only-proof.log`: `diff -u` of the pre-edit snapshot (`00-team-store.before.ts`, 99 183 B, sha256 `06edf44c…`) against the current file (99 370 B, sha256 `46117455…`) is ONE hunk inside the doc block — **8 changed lines, 3 removed, 5 added, 0 of them a non-comment line** (every `+`/`-` line matches `^\s*\*`). |
| the package tests are unchanged | **PASS** | `05-gates.log`: `bun test packages/mpd-team-core-plugin` → **603 pass / 0 fail**, 2 905 `expect()` calls, 42 files — the T22 count. |
| `verify-comment-coverage` and typecheck are green | **PASS** | `05-gates.log`: `VERDICT: PASS — every declaration in the family carries a precise comment and a full signature`; `tsgo --noEmit` → no output, **exit 0**. |

## 3. The dist question, answered with bytes (this cross-check's addition)

A comment-only `src` edit can still stale `dist/` if the bundler emits comments, so I did not assume:

- `07-dist-rebuild-proof.log`: rebuilt BOTH versions with the PINNED toolchain
  (`.toolchain/node_modules/.bin/bun`), each from a root with identical relative paths. The snapshot src and
  the current src emit **byte-identical** output (`f26fdb34…`) → **the edit is dist-neutral.**
- The committed `packages/mpd-team-core-plugin/dist/index.js` is `5edab158…`, i.e. it differs from a fresh
  build of EITHER src — so the package's `dist` was **ALREADY stale before this edit** (matching the
  expected-red dist target A3's review recorded: `mpd-team-core-plugin STALE`). That rebuild belongs to the
  INTEGRATION lane; T30 neither caused nor worsened it.
- `06-dist-rebuild-proof.log` keeps my first, invalid comparison (the copy's entry path changes the bundler's
  marker comments), so the reasoning is auditable rather than tidy.

## 4. Findings

None. No Blocker, no High, no Medium, no Nit. Two record-only facts: the pre-existing `dist` staleness above
(integration lane's), and the note that `diffstat` is not installed here — my first log falls back to counting
changed lines, and the per-line shape proof is what the verdict rests on.

## 5. Bounds

- I judged the SUBSTANCE against the code the comment describes (that is what a doc-accuracy review asks); I
  did not re-derive the whole identity plane — the T22/T24 analyses are cited, not re-run.
- The 603 green tests prove no behaviour change; they do not prove the comment is EXHAUSTIVE about the plane
  (e.g. the delegation-child guard appears only as "the churn heal runs"). It is accurate as far as it goes,
  which is what the finding asked for.
- No runtime behaviour was exercised: a comment cannot change it, and the dist byte proof plus the green
  package tests cover the emitted artifact.
- No code was edited by this cross-check; the only writes are this directory's logs and this file.

## 6. Evidence in this directory (mine)

```
01-scope-and-diffstat.log     the judged files by sha256/size/mtime
02-comment-only-proof.log     the COMPLETE diff + the per-line comment-only proof
03-dist-comments.log          what the emitted dist carries (bundler markers, no doc comments)
04-phrase-grep.log            the first, deliberately broad sweep (kept for honesty)
05-gates.log                  package tests 603/0, typecheck 0, comments PASS
06-dist-rebuild-proof.log     the invalid first comparison and why its markers differ
07-dist-rebuild-proof.log     the decisive before/after byte proof + the committed-dist delta
08-substance.log              the five code citations the comment's claims rest on
09-phrase-grep-scoped.log     the scoped phrase proof + the unrelated `until then` hits disclosed
REPORT.md                     `rev-consume`'s own formal record (not mine)
```
