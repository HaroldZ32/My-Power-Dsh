# W4-A3 — versioned workmate personas, baseRevision CAS, default-drift detection

Lane: Deep Worker (board row **T23**). Contract: `.mpd/plans/autoproject-refactor.md` §10 item A3 + the T23
dispatch text. Scope: `packages/mpd-workmate-plugin/{src,test}` ONLY. `dist/` was NOT rebuilt and no git
command was run.

## 1. The field contract (`meta.json`)

| Field | Meaning | Value |
|---|---|---|
| `personaRevision` | the instance's OWN history counter — the **CAS token** a writer names | monotone integer, `1` at birth, `+1` per persona write, `0`/absent = "not versioned yet" |
| `personaHash` | sha256 of the CURRENT persona text (`readPersona`'s trimmed text) | hex, or `unknown` when the file could not be read |
| `baseRevision` | sha256 of the BASE ROSTER PERSONA the instance was born from — the **drift baseline** | hex, or `unknown` when the roster could not answer |

THE NAME TRAP is documented at the `Meta` type: `mpd_workmate_persona_set`'s `baseRevision` PARAMETER is the
integer `personaRevision` (the CAS token), while `meta.baseRevision` is the sha256 baseline. Two different
things, one spelling, stated in the type, the tool description and both schemas.

**On disk** (`src/index.ts`): `persona.versions/<revision>.md` (one file per revision, monotone, NEVER
overwritten — `writePersonaVersion` throws rather than clobber, and `nextFreeRevision` walks past a
hand-restored file) and `persona.base.md` (the birth text of the base, written once by `writeBaseSnapshot`).

**Read-compat / backfill**: `personaRecordOf` computes the record WITHOUT writing (a list call mutates
nothing); `applyPersonaWrite` is the ONE write path and backfills a legacy instance — its current text
becomes its own revision file, `persona.base.md` is taken from the current base, and the three fields are
recorded. A base the roster cannot resolve records `unknown` rather than a fabricated digest.

## 2. The CAS tool — `mpd_workmate_persona_set {name, persona, baseRevision}`

- `baseRevision` is REQUIRED and must equal the effective current revision (the same number
  `mpd_workmate_list` reports, so a legacy instance's effective revision 1 is addressable).
- A mismatch (or a non-integer token) is REFUSED and **nothing is written** — not the persona, not the
  metadata, not a version file — and the draft is NOT discarded. Exact refusal sentence:
  `stale baseRevision: the draft was based on revision <claimed> but this workmate is at revision <current>; re-read the persona and rebase`
  carried on `{ name, updated:false, refused, currentRevision, currentPersonaChars }` (the two numbers a
  caller needs to rebase). A refusal is a RESULT, not a throw.
- A match REPLACES `persona.md` with the caller's text (the tool is a SET; `mpd_workmate_reflect` remains
  the append-a-delta path), bumps `personaRevision`, rewrites `personaHash`, appends the version file and
  writes exactly ONE journal line (`rowLogLine("mpd-workmate", "persona_set <name> revision N -> M (sha256 …)")`).

## 3. Drift computation

`personaDrift(meta, dir, currentBase)`:
- no stored baseline, or the roster cannot answer → `{defaultUpdated:false, baseDriftLines:0, baseDriftUnknown:true}` (the honest "cannot compare", never a false alarm);
- `sha256(currentBase.trim()) === meta.baseRevision` → `{false, 0, false}`;
- otherwise `{true, lineDiffCount(persona.base.md, currentBase), false}`.

`lineDiffCount` is `|a| + |b| − 2·LCS(a,b)` over `\n`-split lines (a real line diff, not a guess): the
snapshot is the left side, the CURRENT base persona the right. Above 800 lines on either side the LCS is
skipped for a multiset difference (an upper bound, documented) so a pathological input cannot hang a list.

`mpd_workmate_list` reports `personaRevision`, `personaHash`, `baseRevision`, `defaultUpdated`,
`baseDriftLines`, `baseDriftUnknown` on every row, and the **note card** carries
`[defaultUpdated=true baseDriftLines=N — the base persona moved ahead of this workmate]` — both in the row's
`note` field and in the `note.md` a reflect persists (`noteWithDrift` is idempotent: it strips a previous
marker before deciding, so a re-render never stacks one and a caught-up base clears it). The list RENDER
also prints `default-updated:NL` / `default-unverified`.

## 4. `mpd_workmate_reflect`

Unchanged signature and behaviour, plus: a `persona_delta` now goes through `applyPersonaWrite` (bump), so
it creates a version file and moves the record; a reflect WITHOUT a delta still backfills a legacy instance
and never invents a revision. The note it persists is drift-marked. Its arm in `workmate.test.ts` is
untouched and green.

## 5. Also changed (coherence, inside the same wave)

`mergeOneWorkmate` used to `writeFileSync(persona.md)` directly, which would have left `meta.personaHash`
describing the pre-merge text. It now routes the merged persona through `applyPersonaWrite` (bump,
`currentBase: null`), so a merge is versioned like every other persona write. Pinned by two new assertions
in `optimize.test.ts`'s (e2) arm.

## 6. Gates (command + observed result)

| Command | Result |
|---|---|
| `bun test packages/mpd-workmate-plugin` | **74 pass / 0 fail**, 753 `expect()` calls, exit 0 (`tests.log`) |
| `bunx tsgo --noEmit` | **0 errors**, exit 0 (`typecheck.log`) |
| `bun run verify:comments` | **VERDICT: PASS**, exit 0 (`comments.log`) |

**Existing arms changed (provenance-forced, 2 of 69):**
1. `rename-delete.test.ts` "delete never touches another workmate's bytes" — its byte walk read every
   entry of an instance directory as TEXT; an instance now legitimately owns a `persona.versions/`
   SUBDIRECTORY, so the walk became `allFilesText` (recursive). The assertion's intent is unchanged and now
   covers the new files too.
2. `rename-delete.test.ts` "the mutation tools' declared output schemas accept the values they return" —
   EXTENDED (not weakened) with the new tool's two result shapes (accepted + refused) through the same
   real harness validator.
   Plus one mechanical fixture edit: the `Meta` literal in `workmate.test.ts` gained the three new fields
   (the type requires them).

**New arms** (`test/persona-versions.test.ts`, 5 cases): (a) stale CAS refused with a byte-identical
persona; (b) a matching write bumps and writes exactly one new version file; (c) drift false at birth,
true with `baseDriftLines = 4` after the base moves (1 deletion + 3 insertions), marker idempotent, cleared
when the base returns; (d) a hand-made legacy instance backfills on the next write; (e) a hand-restored
`2.md` is never overwritten (the write lands on 3).

## 7. What I could NOT prove

1. **No real boot / no dist rebuild** (both out of scope by contract): nothing here proves the row mounts
   with the new tool registered in a live composition; every arm drives the shipped handlers through a fake
   ctx with a sandbox `HOME`.
2. **`mpd_workmate_list`'s drift probe reads the roster PER ROW.** With a large library this is one
   `mpdRoles.list()` call per instance; correctness is proven, cost is not measured.
3. The `MAX_DIFF_LINES` fallback is a documented upper bound (multiset difference), exercised by no arm —
   generating an 800-line persona pair would only prove the branch runs, not what it is worth.
4. `rename`/`delete`/`optimize` were not re-audited beyond their suites: rename moves the directory (so the
   version files travel) and delete archives it, both by `renameSync`, which the existing arms already pin.
